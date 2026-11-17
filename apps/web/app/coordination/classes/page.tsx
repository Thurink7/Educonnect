"use client";

import { FormEvent, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import type { SchoolClass, UserProfile } from "@educonnect/shared";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { apiRequest } from "@/lib/api";
import { auth } from "@/lib/firebase";

export default function CoordinationClassesPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [name, setName] = useState("");
  const [shift, setShift] = useState("Manhã");
  const [subjects, setSubjects] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState("100");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(current: User) {
    try {
      const [me, result] = await Promise.all([apiRequest<{ user: UserProfile }>(current, "/me"), apiRequest<{ classes: SchoolClass[] }>(current, "/classes")]);
      if (me.user.role !== "coordination") { router.replace("/dashboard"); return; }
      setProfile(me.user); setClasses(result.classes);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar as turmas."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (!auth) { router.replace("/login"); return; }
    return onAuthStateChanged(auth, async (current) => { if (!current) { router.replace("/login"); return; } setUser(current); await load(current); });
  }, [router]);

  function useLocation() {
    if (!navigator.geolocation) { setError("Este navegador não oferece localização."); return; }
    setLocating(true); setError("");
    navigator.geolocation.getCurrentPosition((result) => { setLatitude(result.coords.latitude.toFixed(6)); setLongitude(result.coords.longitude.toFixed(6)); setNotice("Localização preenchida. Ajuste o raio conforme a sala."); setLocating(false); }, () => { setError("Não foi possível obter a localização da sala."); setLocating(false); }, { enableHighAccuracy: true, timeout: 10000 });
  }
  async function createClass(event: FormEvent) {
    event.preventDefault(); if (!user) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<{ schoolClass: SchoolClass }>(user, "/classes", { method: "POST", body: JSON.stringify({ name, shift, subjects: subjects.split(",").map((item) => item.trim()).filter(Boolean), location: { latitude: Number(latitude), longitude: Number(longitude), radiusMeters: Number(radius) }, schedule: [] }) });
      setNotice(`Turma ${result.schoolClass.name} cadastrada.`); setName(""); setSubjects(""); await load(user);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível cadastrar a turma."); }
    finally { setBusy(false); }
  }

  return <main className="app-shell"><AppSidebar profile={profile} active="school-classes" /><section className="workspace">
    <header className="topbar"><div className="breadcrumbs">Educonnect <span>/</span> Gestão escolar <span>/</span> Turmas</div><span className="role-chip">{classes.length} turmas</span></header>
    <div className="page-content"><div className="greeting-row"><div><p className="eyebrow">GESTÃO ESCOLAR</p><h1>Turmas</h1><p className="subtitle">Organize as turmas e cadastre as disciplinas disponíveis.</p></div></div>
      {error && <div className="notice" role="alert"><span>ⓘ</span><div>{error}</div></div>}{notice && <div className="success-note" role="status">✓ {notice}</div>}
      <section className="coord-section"><div className="section-heading"><div><h2>Turmas cadastradas</h2><p>Abra uma turma para consultar frequência e chamada.</p></div></div>
        {loading ? <div className="card loading-card"><span className="spinner blue-spinner" />Carregando turmas...</div> : classes.length ? <div className="class-summary-grid">{classes.map((schoolClass) => <a className="class-summary-card" href={`/classes/${schoolClass.id}`} key={schoolClass.id}><div className="class-summary-head"><div className="class-avatar">{schoolClass.name.slice(0, 2).toUpperCase()}</div><span className="class-arrow">↗</span></div><h3>{schoolClass.name}</h3><p>{schoolClass.shift} · {schoolClass.studentCount ?? schoolClass.studentIds?.length ?? 0} estudantes</p><div className="class-subjects">{schoolClass.subjects.map((item) => <span key={item}>{item}</span>)}</div><span className="card-hint">Abrir turma em foco <b>→</b></span></a>)}</div> : <div className="empty-inline card">Nenhuma turma cadastrada. Use o formulário para criar a primeira.</div>}
      </section>
      <section className="coord-section"><div className="section-heading"><div><h2>Cadastrar turma</h2><p>As disciplinas cadastradas poderão ser atribuídas aos professores.</p></div></div>
        <form className="card management-form" onSubmit={createClass}><div className="form-grid">
          <label>Nome da turma<input required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: 2º B — Desenvolvimento de Sistemas" /></label>
          <label>Turno<select value={shift} onChange={(e) => setShift(e.target.value)}><option>Manhã</option><option>Tarde</option><option>Noite</option><option>Integral</option></select></label>
          <label className="span-two">Disciplinas<input required value={subjects} onChange={(e) => setSubjects(e.target.value)} placeholder="Matemática, Português, Desenvolvimento Web" /><small>Separe as disciplinas com vírgulas.</small></label>
          <div className="location-label span-two"><div><strong>Localização da sala</strong><small>Usada para validar a presença por QR Code.</small></div><button className="outline-button" type="button" disabled={locating} onClick={useLocation}>⌖ {locating ? "Obtendo localização..." : "Usar localização atual"}</button></div>
          <label>Latitude<input type="number" step="any" required value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="-8.2832" /></label>
          <label>Longitude<input type="number" step="any" required value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="-34.9230" /></label>
          <label>Raio permitido (metros)<input type="number" min="20" max="1000" required value={radius} onChange={(e) => setRadius(e.target.value)} /></label>
        </div><div className="form-actions"><p>O sistema guarda a localização da sala; não armazena as coordenadas exatas dos estudantes.</p><button className="primary-link" disabled={busy}>{busy ? "Salvando..." : "Salvar turma"}</button></div></form>
      </section>
      <footer className="app-footer"><span>© 2026 Educonnect</span><span>Gestão escolar, mais próxima.</span></footer>
    </div>
  </section></main>;
}
