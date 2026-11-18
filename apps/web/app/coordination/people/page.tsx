"use client";

import { FormEvent, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import type { SchoolClass, UserProfile } from "@educonnect/shared";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { apiRequest } from "@/lib/api";
import { auth } from "@/lib/firebase";

type Assignment = { classId: string; subjects: string[] };
type Person = UserProfile & { uid: string; disabled?: boolean };

export default function CoordinationPeoplePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [editing, setEditing] = useState<Person | null>(null);
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [role, setRole] = useState<"teacher" | "student">("teacher");
  const [registration, setRegistration] = useState(""); const [guardian, setGuardian] = useState("");
  const [guardianEmail, setGuardianEmail] = useState(""); const [guardianPhone, setGuardianPhone] = useState("");
  const [classIds, setClassIds] = useState<string[]>([]); const [subjectMap, setSubjectMap] = useState<Record<string, string[]>>({});
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);

  async function load(current: User) {
    try {
      const [me, classData, userData] = await Promise.all([
        apiRequest<{ user: UserProfile }>(current, "/me"), apiRequest<{ classes: SchoolClass[] }>(current, "/classes"), apiRequest<{ users: Person[] }>(current, "/users")
      ]);
      if (me.user.role !== "coordination") { router.replace("/dashboard"); return; }
      setProfile(me.user); setClasses(classData.classes); setPeople(userData.users);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar os perfis."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (!auth) { router.replace("/login"); return; }
    return onAuthStateChanged(auth, async (current) => { if (!current) { router.replace("/login"); return; } setUser(current); await load(current); });
  }, [router]);

  function toggleClass(classId: string) {
    setClassIds((current) => current.includes(classId) ? current.filter((id) => id !== classId) : [...current, classId]);
  }
  function toggleSubject(classId: string, subject: string) {
    setSubjectMap((current) => {
      const selected = current[classId] ?? [];
      return { ...current, [classId]: selected.includes(subject) ? selected.filter((item) => item !== subject) : [...selected, subject] };
    });
  }
  function resetForm() {
    setEditing(null); setName(""); setEmail(""); setPassword(""); setRole("teacher"); setRegistration(""); setGuardian(""); setGuardianEmail(""); setGuardianPhone(""); setClassIds([]); setSubjectMap({});
  }
  function editPerson(person: Person) {
    const assignments = (person.teachingAssignments ?? (person.classIds ?? []).map((classId) => ({ classId, subjects: [] }))).filter((item) => classes.some((schoolClass) => schoolClass.id === item.classId));
    const activeClassIds = (person.classIds ?? []).filter((id) => classes.some((schoolClass) => schoolClass.id === id));
    setEditing(person); setName(person.displayName); setEmail(person.email); setPassword(""); setRole(person.role as "teacher" | "student");
    setRegistration(person.registration ?? ""); setGuardian(person.guardian?.name ?? ""); setGuardianEmail(person.guardian?.email ?? ""); setGuardianPhone(person.guardian?.phone ?? "");
    setClassIds(person.role === "teacher" ? assignments.map((item) => item.classId) : activeClassIds);
    setSubjectMap(Object.fromEntries(assignments.map((item) => [item.classId, item.subjects.length ? item.subjects : (classes.find((schoolClass) => schoolClass.id === item.classId)?.subjects ?? [])])));
    document.getElementById("person-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function deletePerson(person: Person) {
    if (!user || !window.confirm(`Excluir o acesso de ${person.displayName}? O histórico de frequência será preservado.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(user, `/users/${person.uid}`, { method: "DELETE" });
      if (editing?.uid === person.uid) resetForm();
      setNotice(`Acesso de ${person.displayName} excluído.`);
      await load(user);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível excluir a pessoa."); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!user) return;
    setBusy(true); setError(""); setNotice("");
    const teachingAssignments: Assignment[] = classIds.map((classId) => ({ classId, subjects: subjectMap[classId] ?? [] }));
    try {
      if (editing) {
        const body = { displayName: name, email, ...(password ? { password } : {}), ...(role === "teacher" ? { teachingAssignments } : { classIds, registration, guardian: { name: guardian, email: guardianEmail, phone: guardianPhone } }) };
        await apiRequest<{ user: Person }>(user, `/users/${editing.uid}`, { method: "PATCH", body: JSON.stringify(body) });
        setNotice(`Dados e vínculos de ${name} atualizados.`);
      } else {
        const body = { displayName: name, email, password, role, ...(role === "teacher" ? { teachingAssignments } : { classIds, registration, guardian: { name: guardian, email: guardianEmail, phone: guardianPhone } }) };
        await apiRequest<{ user: Person }>(user, "/users", { method: "POST", body: JSON.stringify(body) });
        setNotice(`${role === "teacher" ? "Professor" : "Estudante"} cadastrado com sucesso.`);
      }
      resetForm(); await load(user);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar o perfil."); }
    finally { setBusy(false); }
  }

  const visiblePeople = [...people].sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
  const assignmentNeedsSubject = role === "teacher" && classIds.some((classId) => !(subjectMap[classId]?.length));
  return <main className="app-shell"><AppSidebar profile={profile} active="people" /><section className="workspace">
    <header className="topbar"><div className="breadcrumbs">Educonnect <span>/</span> Gestão escolar <span>/</span> Pessoas</div><span className="role-chip">{people.length} perfis</span></header>
    <div className="page-content"><div className="greeting-row"><div><p className="eyebrow">GESTÃO ESCOLAR</p><h1>Pessoas</h1><p className="subtitle">Cadastre a equipe e mantenha turmas e disciplinas de cada professor atualizadas.</p></div></div>
      {error && <div className="notice" role="alert"><span>ⓘ</span><div>{error}</div></div>}{notice && <div className="success-note" role="status">✓ {notice}</div>}
      <section id="person-form" className="coord-section"><div className="section-heading"><div><h2>{editing ? `Editar ${role === "teacher" ? "professor" : "estudante"}` : "Cadastrar pessoa"}</h2><p>{editing ? "Ajuste os dados de acesso, informações pessoais e turmas vinculadas." : "Escolha o perfil para exibir os campos correspondentes."}</p></div>{editing && <button className="outline-button" type="button" onClick={resetForm}>Cancelar edição</button>}</div>
        <form className="card management-form" onSubmit={submit}>
          <div className="form-grid">
            <label>Nome completo<input required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome e sobrenome" /></label>
            <label>E-mail de acesso<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@escola.com.br" /></label>
            <label>{editing ? "Nova senha (opcional)" : "Senha provisória"}<input required={!editing} type="password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={editing ? "Deixe em branco para manter" : "Mínimo 10 caracteres"} /><small>{editing ? "Preencha apenas se for trocar a senha de acesso." : "Compartilhe a senha diretamente com a pessoa."}</small></label>
            {!editing && <label>Perfil<select value={role} onChange={(e) => { setRole(e.target.value as "teacher" | "student"); setClassIds([]); setSubjectMap({}); }}><option value="teacher">Professor</option><option value="student">Estudante</option></select></label>}
            {role === "student" && <>
              <label>Matrícula<input required value={registration} onChange={(e) => setRegistration(e.target.value)} placeholder="Número de matrícula" /></label>
              <label>Nome do responsável<input required value={guardian} onChange={(e) => setGuardian(e.target.value)} placeholder="Nome completo" /></label>
              <label>E-mail do responsável<input type="email" value={guardianEmail} onChange={(e) => setGuardianEmail(e.target.value)} placeholder="Opcional" /></label>
              <label>Telefone do responsável<input value={guardianPhone} onChange={(e) => setGuardianPhone(e.target.value)} placeholder="Opcional" /></label>
            </>}
          </div>
          <div className="assignment-section"><div className="assignment-heading"><div><strong>{role === "teacher" ? "Turmas e disciplinas" : "Turmas do estudante"}</strong><small>{role === "teacher" ? "Marque cada turma e as disciplinas que este professor leciona nela." : "O estudante poderá consultar a frequência das turmas vinculadas."}</small></div><span>{classIds.length} selecionada{classIds.length === 1 ? "" : "s"}</span></div>
            {classes.length ? <div className="assignment-grid">{classes.map((schoolClass) => {
              const selected = classIds.includes(schoolClass.id);
              return <div className={`assignment-card ${selected ? "is-selected" : ""}`} key={schoolClass.id}>
                <label className="assignment-class"><input type="checkbox" checked={selected} onChange={() => toggleClass(schoolClass.id)} /><span><strong>{schoolClass.name}</strong><small>{schoolClass.shift}</small></span></label>
                {role === "teacher" && selected && <div className="subject-options"><span>Disciplinas</span>{schoolClass.subjects.map((subject) => <label className="subject-option" key={subject}><input type="checkbox" checked={(subjectMap[schoolClass.id] ?? []).includes(subject)} onChange={() => toggleSubject(schoolClass.id, subject)} /><span>{subject}</span></label>)}</div>}
              </div>;
            })}</div> : <div className="empty-inline">Cadastre uma turma antes de atribuir vínculos.</div>}
          </div>
          <div className="form-actions"><p>{assignmentNeedsSubject ? "Escolha ao menos uma disciplina em cada turma selecionada." : role === "teacher" ? "As atribuições podem ser alteradas depois, sem recriar o acesso do professor." : "Você poderá ajustar os vínculos posteriormente."}</p><button className="primary-link" disabled={busy || loading || assignmentNeedsSubject}>{busy ? "Salvando..." : editing ? "Salvar alterações" : "Criar perfil"}</button></div>
        </form>
      </section>
      <section className="coord-section"><div className="section-heading"><div><h2>Perfis cadastrados</h2><p>Edite os dados e vínculos de professores e estudantes ou remova acessos.</p></div></div>
        {loading ? <div className="card loading-card"><span className="spinner blue-spinner" />Carregando perfis...</div> : visiblePeople.length ? <div className="people-list card">{visiblePeople.map((person) => <article className="person-row" key={person.uid}><span className={`person-avatar ${person.role}`}>{person.displayName.slice(0, 1).toUpperCase()}</span><div className="person-main"><strong>{person.displayName}</strong><small>{person.role === "teacher" ? "Professor" : "Estudante"} · {person.email}</small>{person.role === "teacher" && <small>{(person.teachingAssignments ?? []).map((item) => { const schoolClass = classes.find((entry) => entry.id === item.classId); return `${schoolClass?.name ?? "Turma"}: ${item.subjects.join(", ")}`; }).join(" · ") || "Sem turma atribuída"}</small>}{person.role === "student" && <small>Matrícula {person.registration ?? "não informada"} · {(person.classIds ?? []).map((id) => classes.find((entry) => entry.id === id)?.name ?? "Turma").join(", ") || "Sem turma"}</small>}</div><div className="person-actions"><button className="outline-button person-edit" type="button" onClick={() => editPerson(person)}>Editar</button><button className="outline-button danger-outline" type="button" disabled={busy} onClick={() => void deletePerson(person)}>Excluir</button></div></article>)}</div> : <div className="empty-inline card">Ainda não há pessoas cadastradas.</div>}
      </section>
      <footer className="app-footer"><span>© 2026 Educonnect</span><span>Gestão escolar, mais próxima.</span></footer>
    </div>
  </section></main>;
}
