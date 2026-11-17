"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import type { DashboardClassSummary, StaffDashboardSummary, UserProfile } from "@educonnect/shared";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { apiRequest } from "@/lib/api";
import { auth } from "@/lib/firebase";

type LiveLesson = { id: string; classId: string; className: string; subject: string; mode: "in-person" | "remote"; teacherName: string; startsAt: string; presentCount: number };

export default function CoordinationPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [classes, setClasses] = useState<DashboardClassSummary[]>([]);
  const [live, setLive] = useState<LiveLesson[]>([]);
  const [summary, setSummary] = useState<StaffDashboardSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load(current: User, initial = false) {
    if (initial) setLoading(true);
    try {
      const me = await apiRequest<{ user: UserProfile }>(current, "/me");
      if (me.user.role !== "coordination") { router.replace("/dashboard"); return; }
      setProfile(me.user);
      const [dashboard, sessions] = await Promise.all([
        apiRequest<{ summary: StaffDashboardSummary }>(current, "/dashboard/summary"),
        apiRequest<{ sessions: LiveLesson[] }>(current, "/dashboard/monitoring")
      ]);
      setSummary(dashboard.summary);
      setClasses(dashboard.summary.classes);
      setLive(sessions.sessions);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar o acompanhamento escolar."); }
    finally { if (initial) setLoading(false); }
  }

  useEffect(() => {
    if (!auth) { router.replace("/login"); return; }
    return onAuthStateChanged(auth, async (current) => {
      if (!current) { router.replace("/login"); return; }
      setUser(current);
      await load(current, true);
    });
  }, [router]);
  useEffect(() => { if (!user) return; const timer = window.setInterval(() => void load(user), 12000); return () => window.clearInterval(timer); }, [user]);

  const classCount = summary?.classCount ?? classes.length;
  return <main className="app-shell">
    <AppSidebar profile={profile} active="coordination" />
    <section className="workspace">
      <header className="topbar"><div className="breadcrumbs">Educonnect <span>/</span> Acompanhamento</div><span className="live-indicator"><i /> ATUALIZAÇÃO AUTOMÁTICA</span></header>
      <div className="page-content">
        <div className="greeting-row"><div><p className="eyebrow">PAINEL DA COORDENAÇÃO</p><h1>Acompanhamento escolar</h1><p className="subtitle">Um panorama claro das turmas, da frequência e das aulas em andamento.</p></div><a className="primary-link" href="/coordination/classes">＋ Nova turma</a></div>
        {error && <div className="notice" role="alert"><span>ⓘ</span><div>{error}</div></div>}
        {loading ? <div className="card loading-card"><span className="spinner blue-spinner" />Carregando dados do colégio...</div> : <>
          <div className="stats-grid coordination-stats">
            <article className="stat-card"><div className="stat-icon blue">▦</div><p>Turmas</p><strong className="stat-value">{classCount}</strong><small>cadastradas no colégio</small></article>
            <article className="stat-card"><div className="stat-icon violet">♙</div><p>Estudantes</p><strong className="stat-value">{summary?.studentCount ?? 0}</strong><small>com perfil ativo</small></article>
            <article className="stat-card"><div className="stat-icon green">♧</div><p>Professores</p><strong className="stat-value">{summary?.teacherCount ?? 0}</strong><small>com turma vinculada</small></article>
            <article className="stat-card"><div className="stat-icon orange">◷</div><p>Aulas ativas</p><strong className="stat-value">{live.length}</strong><small>chamadas em andamento</small></article>
          </div>
          <section className="coord-section">
            <div className="section-heading"><div><h2>Chamadas em andamento</h2><p>Atualizadas automaticamente a cada 12 segundos</p></div><span className="live-indicator"><i /> AO VIVO</span></div>
            {live.length ? <div className="live-grid">{live.map((item) => <article className="card live-card" key={item.id}><div className="live-card-top"><span className="live-badge"><i /> EM ANDAMENTO</span><span className="mode-pill">{item.mode === "in-person" ? "Presencial" : "Remota"}</span></div><h3>{item.className}</h3><p>{item.subject} · {item.teacherName}</p><div className="live-card-bottom"><span>Iniciada às {new Date(item.startsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span><strong>{item.presentCount} presentes</strong><a href={`/classes/${item.classId}`}>Abrir turma →</a></div></article>)}</div> : <div className="empty-inline card">Nenhuma chamada aberta agora.</div>}
          </section>
          <section className="coord-section"><div className="section-heading"><div><h2>Turmas em foco</h2><p>Frequência registrada nos últimos sete dias</p></div><a href="/coordination/classes">Gerenciar turmas →</a></div>
            {classes.length ? <div className="class-summary-grid">{classes.map((item) => <a className="class-summary-card" href={`/classes/${item.id}`} key={item.id}><div className="class-summary-head"><div className="class-avatar">{item.name.slice(0, 2).toUpperCase()}</div><span className="class-arrow">↗</span></div><h3>{item.name}</h3><p>{item.shift} · {item.studentCount} estudantes</p><div className="focus-metric"><div className="focus-metric-head"><span>Frequência recente</span><strong>{item.attendanceRate}%</strong></div><div className="progress-track"><i style={{ width: `${Math.min(100, item.attendanceRate)}%` }} /></div></div><span className="card-hint">Abrir visão da turma <b>→</b></span></a>)}</div> : <div className="empty-state card"><div className="empty-icon">▦</div><h3>Comece cadastrando uma turma</h3><p>Depois, associe estudantes e professores para acompanhar a frequência.</p><a className="primary-link" href="/coordination/classes">Cadastrar turma</a></div>}
          </section>
          <section className="coord-shortcut-grid"><a className="card coord-shortcut" href="/coordination/people"><span className="shortcut-icon">♙</span><div><strong>Pessoas e vínculos</strong><small>Cadastre ou atualize professores e estudantes.</small></div><b>→</b></a><a className="card coord-shortcut" href="/coordination/protocols"><span className="shortcut-icon">♧</span><div><strong>Alertas e protocolos</strong><small>Acompanhe casos que precisam de atenção.</small></div><b>→</b></a></section>
        </>}
        <footer className="app-footer"><span>© 2026 Educonnect</span><span>Gestão escolar, mais próxima.</span></footer>
      </div>
    </section>
  </main>;
}
