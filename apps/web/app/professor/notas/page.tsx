"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import type { GradeSubmission, SchoolClass, UserProfile } from "@educonnect/shared";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { apiRequest } from "@/lib/api";
import { auth } from "@/lib/firebase";
import { parseGradeSpreadsheet } from "@/lib/spreadsheet-import";

type RosterStudent = { uid: string; displayName: string; registration?: string };
type Row = { studentId: string; studentName: string; registration?: string; partialGrades: string[] };
type Submission = GradeSubmission & { className: string; feedback?: string | null };
const statusLabel: Record<GradeSubmission["status"], string> = { draft: "Rascunho", pending: "Aguardando coordenação", approved: "Aprovado", rejected: "Devolvido" };
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export default function TeacherGradesPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [classId, setClassId] = useState("");
  const [subject, setSubject] = useState("");
  const [term, setTerm] = useState("1º Bimestre");
  const [academicYear, setAcademicYear] = useState(String(new Date().getFullYear()));
  const [labels, setLabels] = useState(["Avaliação 1", "Avaliação 2"]);
  const [rows, setRows] = useState<Row[]>([]);
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const assignments = profile?.teachingAssignments ?? [];
  const availableClasses = classes.filter((item) => assignments.some((assignment) => assignment.classId === item.id));
  const selectedClass = availableClasses.find((item) => item.id === classId);
  const availableSubjects = useMemo(() => assignments.find((item) => item.classId === classId)?.subjects ?? selectedClass?.subjects ?? [], [assignments, classId, selectedClass]);
  async function reload() {
    if (!auth?.currentUser) return;
    const [classResult, submissionResult] = await Promise.all([apiRequest<{ classes: SchoolClass[] }>(auth.currentUser, "/classes"), apiRequest<{ submissions: Submission[] }>(auth.currentUser, "/grade-submissions")]);
    setClasses(classResult.classes); setSubmissions(submissionResult.submissions);
  }
  useEffect(() => {
    if (!auth) { router.replace("/login"); return; }
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.replace("/login"); return; }
      try { const me = await apiRequest<{ user: UserProfile }>(user, "/me"); if (me.user.role !== "teacher") { router.replace("/dashboard"); return; } setProfile(me.user); await reload(); }
      catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar os dados do professor."); }
    });
  }, [router]);
  useEffect(() => { if (selectedClass && !selectedClass.subjects.includes(subject) && !availableSubjects.includes(subject)) setSubject(availableSubjects[0] ?? ""); }, [classId, selectedClass, availableSubjects, subject]);
  async function loadRoster(nextClassId: string) {
    setClassId(nextClassId); setEditingId(""); setRows([]); setMessage(""); setError("");
    if (!auth?.currentUser || !nextClassId) return;
    try { const result = await apiRequest<{ roster: RosterStudent[] }>(auth.currentUser, `/classes/${nextClassId}/roster`); setRows(result.roster.map((student) => ({ studentId: student.uid, studentName: student.displayName, registration: student.registration, partialGrades: labels.map(() => "") }))); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar a turma."); }
  }
  function resizeLabels(next: string[]) { setLabels(next); setRows((current) => current.map((row) => ({ ...row, partialGrades: next.map((_, index) => row.partialGrades[index] ?? "") }))); }
  function edit(item: Submission) {
    setEditingId(item.id); setClassId(item.classId); setSubject(item.subject); setTerm(item.term); setAcademicYear(item.academicYear); setLabels(item.gradeLabels);
    setRows(item.entries.map((entry) => ({ studentId: entry.studentId, studentName: entry.studentName, registration: entry.registration, partialGrades: entry.partialGrades.map((grade) => grade === null ? "" : String(grade)) })));
    setMessage(""); setError(""); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function importFile(file?: File) {
    if (!file) return;
    setError(""); setMessage("");
    try {
      const data = await parseGradeSpreadsheet(file);
      const findHeader = (terms: string[]) => data.headers.findIndex((header) => terms.includes(normalized(header)));
      const registrationIndex = findHeader(["matricula", "registro", "ra"]);
      const idIndex = findHeader(["uid", "studentid", "id aluno", "id do aluno"]);
      const nameIndex = findHeader(["aluno", "nome", "nome do aluno", "estudante"]);
      const excluded = new Set([registrationIndex, idIndex, nameIndex, findHeader(["email"]), findHeader(["media", "media final"])].filter((index) => index >= 0));
      const gradeIndexes = data.headers.map((_, index) => index).filter((index) => !excluded.has(index));
      if (!gradeIndexes.length) throw new Error("A planilha precisa ter ao menos uma coluna de nota além dos dados do aluno.");
      if (!rows.length) throw new Error("Selecione uma turma antes de importar a planilha.");
      const byRegistration = new Map(rows.filter((row) => row.registration).map((row) => [normalized(row.registration!), row]));
      const byName = new Map(rows.map((row) => [normalized(row.studentName), row]));
      const byId = new Map(rows.map((row) => [row.studentId, row]));
      const seen = new Set<string>();
      let matched = 0;
      const nextRows = rows.map((row) => ({ ...row, partialGrades: gradeIndexes.map(() => "") }));
      for (const values of data.rows) {
        const student = (idIndex >= 0 ? byId.get(values[idIndex]?.trim()) : undefined)
          ?? (registrationIndex >= 0 ? byRegistration.get(normalized(values[registrationIndex] ?? "")) : undefined)
          ?? (nameIndex >= 0 ? byName.get(normalized(values[nameIndex] ?? "")) : undefined);
        if (!student) continue;
        if (seen.has(student.studentId)) throw new Error(`O aluno ${student.studentName} aparece mais de uma vez na planilha.`);
        seen.add(student.studentId); matched += 1;
        const target = nextRows.find((row) => row.studentId === student.studentId)!;
        target.partialGrades = gradeIndexes.map((index) => (values[index] ?? "").trim().replace(",", "."));
      }
      if (!matched) throw new Error("Nenhum aluno da planilha foi identificado. Inclua matrícula, UID ou nome igual ao cadastro da turma.");
      resizeLabels(gradeIndexes.map((index) => data.headers[index])); setRows(nextRows);
      setMessage(`Prévia pronta: ${matched} de ${rows.length} alunos identificados. Confira a tabela antes de salvar.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível importar a planilha."); }
  }
  async function save(send: boolean) {
    if (!auth?.currentUser) return;
    setError(""); setMessage("");
    if (!classId || !subject || !rows.length) { setError("Selecione turma, disciplina e carregue a lista de alunos."); return; }
    if (labels.some((label) => !label.trim())) { setError("Informe um nome para cada avaliação."); return; }
    const entries = rows.map((row) => ({ studentId: row.studentId, partialGrades: row.partialGrades.map((raw) => { if (!raw.trim()) return null; const score = Number(raw.replace(",", ".")); return Number.isFinite(score) ? score : -1; }) }));
    if (entries.some((entry) => entry.partialGrades.some((score) => score !== null && (score < 0 || score > 10)))) { setError("As notas devem ser números entre 0 e 10."); return; }
    if (send && entries.some((entry) => entry.partialGrades.every((score) => score === null))) { setError("Preencha ao menos uma nota para cada aluno antes de enviar."); return; }
    setBusy(true);
    try {
      const body = JSON.stringify({ classId, subject, academicYear, term, gradeLabels: labels, entries });
      let submissionId = editingId;
      if (editingId) await apiRequest(auth.currentUser, `/grade-submissions/${editingId}`, { method: "PATCH", body });
      else { const result = await apiRequest<{ submission: GradeSubmission }>(auth.currentUser, "/grade-submissions", { method: "POST", body }); submissionId = result.submission.id; }
      if (send) await apiRequest(auth.currentUser, `/grade-submissions/${submissionId}/submit`, { method: "POST" });
      setMessage(send ? "Notas enviadas para a Coordenação." : "Rascunho salvo com sucesso."); setEditingId(""); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar o lançamento."); }
    finally { setBusy(false); }
  }
  const pending = rows.filter((row) => row.partialGrades.some(Boolean)).length;
  return <main className="app-shell"><AppSidebar profile={profile} active="teacher-grades"/><section className="workspace"><header className="topbar"><div className="breadcrumbs">Educonnect <span>/</span> Ensino <span>/</span> Lançar notas</div><span className="role-chip">Área do professor</span></header><div className="page-content">
    <div className="greeting-row"><div><p className="eyebrow">AVALIAÇÃO DA TURMA</p><h1>Lançamento de notas</h1><p className="subtitle">Preencha a tabela ou importe um CSV/XLSX para revisar antes do envio.</p></div></div>
    {error && <div className="notice" role="alert">{error}</div>}{message && <div className="success-notice" role="status">{message}</div>}
    <section className="card academic-form-card"><div className="section-heading"><div><h2>{editingId ? "Editar lançamento" : "Novo lançamento"}</h2><p>O envio será revisado pela Coordenação antes de aparecer no boletim.</p></div></div>
      <div className="form-grid academic-form-grid"><label>Turma<select value={classId} onChange={(event) => void loadRoster(event.target.value)}><option value="">Selecione</option>{availableClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Disciplina<select value={subject} onChange={(event) => setSubject(event.target.value)} disabled={!availableSubjects.length}><option value="">Selecione</option>{availableSubjects.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Ano letivo<input value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} maxLength={4}/></label><label>Bimestre/unidade<select value={term} onChange={(event) => setTerm(event.target.value)}>{["1º Bimestre", "2º Bimestre", "3º Bimestre", "4º Bimestre", "1ª Unidade", "2ª Unidade", "3ª Unidade"].map((item) => <option key={item}>{item}</option>)}</select></label></div>
      <div className="grade-toolbar"><label className="outline-button import-button">Importar planilha<input type="file" accept=".csv,.xlsx" onChange={(event) => void importFile(event.target.files?.[0])}/></label><button className="outline-button" onClick={() => resizeLabels([...labels, `Avaliação ${labels.length + 1}`])}>+ Avaliação</button><span>{rows.length} alunos · {pending} com notas</span></div>
      {rows.length ? <div className="table-scroll"><table className="academic-table grade-entry-table"><thead><tr><th>Estudante</th>{labels.map((label, index) => <th key={index}><input aria-label={`Nome da avaliação ${index + 1}`} value={label} onChange={(event) => resizeLabels(labels.map((value, current) => current === index ? event.target.value : value))}/></th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={row.studentId}><td><strong>{row.studentName}</strong><small>{row.registration || "Sem matrícula"}</small></td>{labels.map((_, index) => <td key={index}><input aria-label={`${labels[index]} de ${row.studentName}`} type="number" min="0" max="10" step="0.1" value={row.partialGrades[index] ?? ""} onChange={(event) => setRows((current) => current.map((entry, position) => position === rowIndex ? { ...entry, partialGrades: entry.partialGrades.map((score, scoreIndex) => scoreIndex === index ? event.target.value : score) } : entry))}/></td>)}</tr>)}</tbody></table></div> : <div className="inline-empty">Escolha uma turma para carregar os estudantes e preencher as notas.</div>}
      <div className="form-actions"><button className="outline-button" disabled={busy || !rows.length} onClick={() => void save(false)}>Salvar rascunho</button><button className="primary-button" disabled={busy || !rows.length} onClick={() => void save(true)}>Enviar para Coordenação</button></div>
    </section>
    <section className="submission-list teacher-submissions"><div className="section-heading"><div><h2>Meus lançamentos</h2><p>Acompanhe a situação e os retornos da Coordenação.</p></div></div>{submissions.length ? submissions.map((item) => <article className="card submission-row" key={item.id}><div><span className={`academic-status ${item.status}`}>{statusLabel[item.status]}</span><h3>{item.className} · {item.subject}</h3><p>{item.term} · {item.academicYear} · {item.entries.length} alunos</p>{item.feedback && <p className="feedback-text">Retorno: {item.feedback}</p>}</div>{(item.status === "draft" || item.status === "rejected") && <button className="outline-button" onClick={() => edit(item)}>Editar e reenviar</button>}</article>) : <div className="empty-state card"><p>Seus lançamentos salvos aparecerão aqui.</p></div>}</section>
  </div></section></main>;
}
