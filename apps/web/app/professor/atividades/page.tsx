"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import type { AcademicActivity, SchoolClass, UserProfile } from "@educonnect/shared";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { apiRequest } from "@/lib/api";
import { auth } from "@/lib/firebase";

const localDate = (iso: string) => { const date = new Date(iso); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
export default function TeacherActivitiesPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [activities, setActivities] = useState<AcademicActivity[]>([]);
  const [classId, setClassId] = useState("");
  const [subject, setSubject] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [editingId, setEditingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const assignments = profile?.teachingAssignments ?? [];
  const availableClasses = classes.filter((item) => assignments.some((assignment) => assignment.classId === item.id));
  const availableSubjects = useMemo(() => assignments.find((item) => item.classId === classId)?.subjects ?? classes.find((item) => item.id === classId)?.subjects ?? [], [assignments, classId, classes]);
  async function reload() {
    if (!auth?.currentUser) return;
    const [classResult, activityResult] = await Promise.all([apiRequest<{ classes: SchoolClass[] }>(auth.currentUser, "/classes"), apiRequest<{ activities: AcademicActivity[] }>(auth.currentUser, "/activities")]);
    setClasses(classResult.classes); setActivities(activityResult.activities);
  }
  useEffect(() => {
    if (!auth) { router.replace("/login"); return; }
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.replace("/login"); return; }
      try { const result = await apiRequest<{ user: UserProfile }>(user, "/me"); if (result.user.role !== "teacher") { router.replace("/dashboard"); return; } setProfile(result.user); await reload(); }
      catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar os dados."); }
    });
  }, [router]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!auth?.currentUser) return;
    setError(""); setMessage(""); setBusy(true);
    try {
      const body = JSON.stringify({ classId, subject, title, description, dueAt: new Date(dueAt).toISOString() });
      await apiRequest(auth.currentUser, editingId ? `/activities/${editingId}` : "/activities", { method: editingId ? "PATCH" : "POST", body });
      setMessage(editingId ? "Atividade atualizada." : "Atividade publicada para a turma."); reset(); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar a atividade."); }
    finally { setBusy(false); }
  }
  function reset() { setEditingId(""); setTitle(""); setDescription(""); setDueAt(""); setClassId(""); setSubject(""); }
  function edit(item: AcademicActivity) { setEditingId(item.id); setTitle(item.title); setDescription(item.description); setDueAt(localDate(item.dueAt)); setClassId(item.classId); setSubject(item.subject); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function archive(item: AcademicActivity) {
    if (!auth?.currentUser) return;
    try { await apiRequest(auth.currentUser, `/activities/${item.id}`, { method: "DELETE" }); setMessage("Atividade removida da agenda da turma."); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível remover a atividade."); }
  }
  return <main className="app-shell"><AppSidebar profile={profile} active="teacher-activities"/><section className="workspace"><header className="topbar"><div className="breadcrumbs">Educonnect <span>/</span> Ensino <span>/</span> Atividades</div><span className="role-chip">Área do professor</span></header><div className="page-content">
    <div className="greeting-row"><div><p className="eyebrow">PLANEJAMENTO DIDÁTICO</p><h1>Atividades da turma</h1><p className="subtitle">Publique prazos e orientações para os estudantes acompanharem na agenda.</p></div></div>
    {error && <div className="notice" role="alert">{error}</div>}{message && <div className="success-notice" role="status">{message}</div>}
    <section className="card academic-form-card"><div className="section-heading"><div><h2>{editingId ? "Editar atividade" : "Nova atividade"}</h2><p>As atividades ficam vinculadas à turma, à disciplina e ao professor.</p></div></div><form onSubmit={(event) => void save(event)}><div className="form-grid academic-form-grid"><label>Título<input required minLength={4} maxLength={140} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Pesquisa sobre ecossistemas"/></label><label>Turma<select required value={classId} onChange={(event) => { setClassId(event.target.value); setSubject(""); }}><option value="">Selecione</option>{availableClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Disciplina<select required value={subject} onChange={(event) => setSubject(event.target.value)} disabled={!availableSubjects.length}><option value="">Selecione</option>{availableSubjects.map((item) => <option key={item}>{item}</option>)}</select></label><label>Data e hora limite<input required type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)}/></label><label className="full-field">Descrição<textarea required minLength={10} maxLength={3000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Explique as instruções e os critérios da atividade"/></label></div><div className="form-actions"><button type="submit" className="primary-button" disabled={busy}>{editingId ? "Salvar alterações" : "Publicar atividade"}</button>{editingId && <button type="button" className="outline-button" onClick={reset}>Cancelar</button>}</div></form></section>
    <section className="submission-list teacher-submissions"><div className="section-heading"><div><h2>Atividades publicadas</h2><p>Gerencie as atividades que você criou.</p></div></div>{activities.length ? activities.map((item) => <article className="card submission-row" key={item.id}><div><span className="academic-status pending">{item.className || classes.find((schoolClass) => schoolClass.id === item.classId)?.name} · {item.subject}</span><h3>{item.title}</h3><p>Entrega até {new Date(item.dueAt).toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" })}</p><p>{item.description}</p></div><div className="row-actions"><button className="outline-button" onClick={() => edit(item)}>Editar</button><button className="danger-button" onClick={() => void archive(item)}>Remover</button></div></article>) : <div className="empty-state card"><p>Você ainda não publicou atividades.</p></div>}</section>
  </div></section></main>;
}
