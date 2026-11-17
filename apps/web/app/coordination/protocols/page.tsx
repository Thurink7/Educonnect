"use client";

import { FormEvent, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import type { SchoolClass, UserProfile } from "@educonnect/shared";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { apiRequest } from "@/lib/api";
import { auth } from "@/lib/firebase";

type AlertItem = { studentId: string; studentName: string; classId: string; className: string; attendanceRate: number; absences: number; present: number };
type Protocol = { id: string; studentName: string; className: string; title: string; description: string; status: string; createdAt: string };
type RosterStudent = { uid: string; displayName: string; registration?: string };

export default function CoordinationProtocolsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null); const [profile, setProfile] = useState<UserProfile | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]); const [alerts, setAlerts] = useState<AlertItem[]>([]); const [protocols, setProtocols] = useState<Protocol[]>([]); const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [classId, setClassId] = useState(""); const [studentId, setStudentId] = useState(""); const [title, setTitle] = useState(""); const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");

  async function load(current: User) {
    try {
      const [me, classData, alertData, protocolData] = await Promise.all([
        apiRequest<{ user: UserProfile }>(current, "/me"), apiRequest<{ classes: SchoolClass[] }>(current, "/classes"),
        apiRequest<{ alerts: AlertItem[] }>(current, "/dashboard/alerts"), apiRequest<{ protocols: Protocol[] }>(current, "/protocols")
      ]);
      if (me.user.role !== "coordination") { router.replace("/dashboard"); return; }
      setProfile(me.user); setClasses(classData.classes); setAlerts(alertData.alerts); setProtocols(protocolData.protocols);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar os alertas e protocolos."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (!auth) { router.replace("/login"); return; }
    return onAuthStateChanged(auth, async (current) => { if (!current) { router.replace("/login"); return; } setUser(current); await load(current); });
  }, [router]);
  async function chooseClass(next: string, preferredStudent = "") {
    setClassId(next); setStudentId("");
    if (!user || !next) { setRoster([]); return; }
    try { const result = await apiRequest<{ overview: { roster: RosterStudent[] } }>(user, `/classes/${next}/overview`); setRoster(result.overview.roster); setStudentId(preferredStudent && result.overview.roster.some((item) => item.uid === preferredStudent) ? preferredStudent : ""); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar a lista da turma."); }
  }
  async function createProtocol(event: FormEvent) {
    event.preventDefault(); if (!user) return;
    setBusy(true); setError(""); setNotice("");
    try { await apiRequest(user, "/protocols", { method: "POST", body: JSON.stringify({ classId, studentId, title, description }) }); setNotice("Protocolo registrado para o estudante."); setTitle(""); setDescription(""); await load(user); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível criar o protocolo."); }
    finally { setBusy(false); }
  }

  return <main className="app-shell"><AppSidebar profile={profile} active="school-protocols" /><section className="workspace">
    <header className="topbar"><div className="breadcrumbs">Educonnect <span>/</span> Gestão escolar <span>/</span> Alertas e protocolos</div><span className="role-chip">{alerts.length} alertas</span></header>
    <div className="page-content"><div className="greeting-row"><div><p className="eyebrow">ACOMPANHAMENTO PEDAGÓGICO</p><h1>Alertas e protocolos</h1><p className="subtitle">Identifique quedas de frequência e registre os próximos passos de acompanhamento.</p></div></div>
      {error && <div className="notice" role="alert"><span>ⓘ</span><div>{error}</div></div>}{notice && <div className="success-note" role="status">✓ {notice}</div>}
      <section className="coord-section"><div className="section-heading"><div><h2>Estudantes que precisam de atenção</h2><p>Abaixo de 75% de presença, com ao menos cinco registros em 30 dias.</p></div><span className="alert-count">{alerts.length}</span></div>
        {loading ? <div className="card loading-card"><span className="spinner blue-spinner" />Carregando alertas...</div> : alerts.length ? <div className="alert-list card">{alerts.map((alert) => <article className="alert-detail-row" key={`${alert.studentId}-${alert.classId}`}><span className="alert-symbol">!</span><div className="alert-detail-copy"><strong>{alert.studentName}</strong><small>{alert.className} · {alert.absences} faltas · {alert.present} presenças</small></div><span className="rate-pill low">{alert.attendanceRate}%</span><button className="outline-button" type="button" onClick={() => { void chooseClass(alert.classId, alert.studentId); document.getElementById("protocol-form")?.scrollIntoView({ behavior: "smooth" }); }}>Criar protocolo</button></article>)}</div> : <div className="empty-state card"><div className="empty-icon">✓</div><h3>Nenhum alerta crítico</h3><p>Quando houver uma queda de frequência que exija atenção, ela aparecerá aqui.</p></div>}
      </section>
      <section id="protocol-form" className="coord-section"><div className="section-heading"><div><h2>Novo protocolo</h2><p>Registre orientações e combinados visíveis na conta do estudante.</p></div></div>
        <form className="card management-form" onSubmit={createProtocol}><div className="form-grid">
          <label>Turma<select required value={classId} onChange={(e) => void chooseClass(e.target.value)}><option value="">Selecione uma turma</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Estudante<select required value={studentId} onChange={(e) => setStudentId(e.target.value)}><option value="">Selecione um estudante</option>{roster.map((item) => <option key={item.uid} value={item.uid}>{item.displayName}{item.registration ? ` · ${item.registration}` : ""}</option>)}</select></label>
          <label className="span-two">Título<input required minLength={4} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Plano de acompanhamento de frequência" /></label>
          <label className="span-two">Orientações<textarea required minLength={10} maxLength={2000} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descreva as ações combinadas e o próximo acompanhamento." /></label>
        </div><div className="form-actions"><p>Este registro fica disponível no Educonnect; ele não envia mensagens externas.</p><button className="primary-link" disabled={busy || !studentId}>{busy ? "Salvando..." : "Criar protocolo"}</button></div></form>
      </section>
      <section className="coord-section"><div className="section-heading"><div><h2>Protocolos registrados</h2><p>Orientações existentes no colégio.</p></div></div>
        {protocols.length ? <div className="protocol-list">{protocols.map((item) => <article className="card protocol-card" key={item.id}><div className="protocol-card-heading"><div><span className={`protocol-status ${item.status}`}>{item.status === "resolved" ? "Concluído" : "Em acompanhamento"}</span><h2>{item.title}</h2><p>{item.studentName} · {item.className} · {new Date(item.createdAt).toLocaleDateString("pt-BR")}</p></div><span className="protocol-symbol">▤</span></div><p className="protocol-description">{item.description}</p></article>)}</div> : <div className="empty-inline card">Nenhum protocolo cadastrado.</div>}
      </section>
      <footer className="app-footer"><span>© 2026 Educonnect</span><span>Gestão escolar, mais próxima.</span></footer>
    </div>
  </section></main>;
}
