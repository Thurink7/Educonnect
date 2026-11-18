"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import type { AcademicActivity, UserProfile } from "@educonnect/shared";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { apiRequest } from "@/lib/api";
import { auth } from "@/lib/firebase";

type Activity = AcademicActivity & { status: "pending" | "submitted" | "overdue"; submittedAt?: string };
const labels = { pending: "Pendente", submitted: "Entregue", overdue: "Atrasada" };

export default function StudentActivitiesPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [filter, setFilter] = useState<"all" | Activity["status"]>("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!auth) { router.replace("/login"); return; }
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.replace("/login"); return; }
      try {
        const [me, result] = await Promise.all([apiRequest<{ user: UserProfile }>(user, "/me"), apiRequest<{ activities: Activity[] }>(user, "/activities")]);
        if (me.user.role !== "student") { router.replace("/dashboard"); return; }
        setProfile(me.user); setActivities(result.activities);
      } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar as atividades."); }
      finally { setLoading(false); }
    });
  }, [router]);
  async function complete(activityId: string) {
    if (!auth?.currentUser) return;
    try { await apiRequest(auth.currentUser, `/activities/${activityId}/complete`, { method: "POST" }); setActivities((items) => items.map((item) => item.id === activityId ? { ...item, status: "submitted" } : item)); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível registrar a entrega."); }
  }
  const visible = activities.filter((item) => filter === "all" || item.status === filter);
  return <main className="app-shell"><AppSidebar profile={profile} active="student-activities"/><section className="workspace"><header className="topbar"><div className="breadcrumbs">Educonnect <span>/</span> Minha rotina <span>/</span> Atividades</div><span className="role-chip">Agenda acadêmica</span></header><div className="page-content">
    <div className="greeting-row"><div><p className="eyebrow">ORGANIZE SUA ROTINA</p><h1>Agenda de atividades</h1><p className="subtitle">Acompanhe prazos e registre quando concluir cada atividade.</p></div></div>
    <div className="academic-toolbar">{(["all", "pending", "submitted", "overdue"] as const).map((key) => <button key={key} className={`filter-chip ${filter === key ? "active" : ""}`} onClick={() => setFilter(key)}>{key === "all" ? "Todas" : labels[key]} <span>{key === "all" ? activities.length : activities.filter((item) => item.status === key).length}</span></button>)}</div>
    {error && <div className="notice" role="alert">{error}</div>}{loading ? <div className="card loading-card">Carregando atividades...</div> : visible.length ? <div className="activity-list">{visible.map((item) => <article className="card activity-card" key={item.id}><div className="activity-card-heading"><div><span className={`academic-status ${item.status}`}>{labels[item.status]}</span><h2>{item.title}</h2></div><time>{new Date(item.dueAt).toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" })}</time></div><p>{item.description}</p><div className="activity-meta"><span>{item.subject}</span><span>Prof. {item.teacherName}</span></div>{item.status === "pending" && <button className="outline-button" onClick={() => void complete(item.id)}>Marcar como entregue</button>}</article>)}</div> : <div className="empty-state card"><h3>Nenhuma atividade nesta lista</h3><p>As atividades da sua turma aparecerão aqui.</p></div>}
  </div></section></main>;
}
