"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import type { GradeSubmission, SchoolClass, UserProfile } from "@educonnect/shared";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { apiRequest } from "@/lib/api";
import { auth } from "@/lib/firebase";

type Submission = GradeSubmission & { className: string; feedback?: string | null };
export default function GradeApprovalsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [items, setItems] = useState<Submission[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [selected, setSelected] = useState("");
  const [feedback, setFeedback] = useState("");
  const [returning, setReturning] = useState(false);
  const [filter, setFilter] = useState("pending");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    if (!auth?.currentUser) return;
    const [result, classResult] = await Promise.all([apiRequest<{ submissions: Submission[] }>(auth.currentUser, "/grade-submissions"), apiRequest<{ classes: SchoolClass[] }>(auth.currentUser, "/classes")]);
    setItems(result.submissions); setClasses(classResult.classes);
  }
  useEffect(() => {
    if (!auth) { router.replace("/login"); return; }
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.replace("/login"); return; }
      try { const me = await apiRequest<{ user: UserProfile }>(user, "/me"); if (me.user.role !== "coordination") { router.replace("/dashboard"); return; } setProfile(me.user); await refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar a fila."); }
    });
  }, [router]);
  const visible = useMemo(() => items.filter((item) => (!filter || item.status === filter) && (!selected || item.classId === selected)), [items, filter, selected]);
  async function review(item: Submission, decision: "approve" | "reject") {
    if (!auth?.currentUser) return;
    if (decision === "reject" && !feedback.trim()) { setError("Escreva uma observação antes de devolver este lançamento."); return; }
    setBusy(true); setError("");
    try { await apiRequest(auth.currentUser, `/grade-submissions/${item.id}/review`, { method: "POST", body: JSON.stringify({ decision, ...(decision === "reject" ? { feedback } : {}) }) }); setSelected(""); setReturning(false); setFeedback(""); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível revisar o lançamento."); }
    finally { setBusy(false); }
  }
  return <main className="app-shell"><AppSidebar profile={profile} active="grade-approvals"/><section className="workspace"><header className="topbar"><div className="breadcrumbs">Educonnect <span>/</span> Gestão escolar <span>/</span> Aprovações</div><span className="role-chip">Revisão acadêmica</span></header><div className="page-content">
    <div className="greeting-row"><div><p className="eyebrow">PUBLICAÇÃO DO BOLETIM</p><h1>Aprovação de notas</h1><p className="subtitle">Revise os lançamentos antes que sejam publicados para os estudantes.</p></div><label className="period-filter">Turma<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Todas as turmas</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    <div className="academic-toolbar">{["pending", "approved", "rejected"].map((key) => <button key={key} className={`filter-chip ${filter === key ? "active" : ""}`} onClick={() => setFilter(key)}>{key === "pending" ? "Aguardando" : key === "approved" ? "Aprovadas" : "Devolvidas"}<span>{items.filter((item) => item.status === key).length}</span></button>)}</div>
    {error && <div className="notice" role="alert">{error}</div>}{visible.length ? <div className="submission-list">{visible.map((item) => <article className="card submission-card" key={item.id}><div className="activity-card-heading"><div><span className={`academic-status ${item.status}`}>{item.status === "pending" ? "Aguardando coordenação" : item.status === "approved" ? "Aprovado" : "Devolvido"}</span><h2>{item.className} · {item.subject}</h2></div><span>{item.term} · {item.academicYear}</span></div><p>Professor(a) {item.teacherName} · {item.entries.length} estudantes</p>{item.feedback && <div className="feedback-box"><strong>Observação ao professor</strong><p>{item.feedback}</p></div>}<div className="table-scroll"><table className="academic-table"><thead><tr><th>Estudante</th>{item.gradeLabels.map((label, index) => <th key={`${label}-${index}`}>{label}</th>)}<th>Média</th></tr></thead><tbody>{item.entries.map((entry) => <tr key={entry.studentId}><td>{entry.studentName}</td>{entry.partialGrades.map((score, index) => <td key={index}>{score === null ? "—" : score.toFixed(1)}</td>)}<td><strong>{entry.average === null ? "—" : entry.average.toFixed(1)}</strong></td></tr>)}</tbody></table></div>{item.status === "pending" && <div className="approval-actions">{returning ? <><textarea className="form-input" rows={2} placeholder="Explique o ajuste necessário" value={feedback} onChange={(event) => setFeedback(event.target.value)}/><button className="outline-button" onClick={() => { setReturning(false); setFeedback(""); }}>Cancelar</button><button className="danger-button" disabled={busy} onClick={() => void review(item, "reject")}>Devolver para correção</button></> : <><button className="outline-button" onClick={() => setReturning(true)}>Devolver para correção</button><button className="primary-button" disabled={busy} onClick={() => void review(item, "approve")}>Aprovar e publicar</button></>}</div>}</article>)}</div> : <div className="empty-state card"><h3>Nenhum lançamento nesta fila</h3><p>Os envios dos professores aparecerão aqui.</p></div>}
  </div></section></main>;
}
