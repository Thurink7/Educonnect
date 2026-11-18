"use client";

import { FormEvent, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import type { RoomLocation, SchoolClass, UserProfile } from "@educonnect/shared";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { apiRequest } from "@/lib/api";
import { auth } from "@/lib/firebase";

export default function CoordinationClassesPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [editing, setEditing] = useState<SchoolClass | null>(null);
  const [name, setName] = useState("");
  const [shift, setShift] = useState("Manhã");
  const [subjects, setSubjects] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState("100");
  const [removeLocation, setRemoveLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(current: User) {
    try {
      const [me, result] = await Promise.all([
        apiRequest<{ user: UserProfile }>(current, "/me"),
        apiRequest<{ classes: SchoolClass[] }>(current, "/classes")
      ]);
      if (me.user.role !== "coordination") { router.replace("/dashboard"); return; }
      setProfile(me.user);
      setClasses(result.classes);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar as turmas."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!auth) { router.replace("/login"); return; }
    return onAuthStateChanged(auth, async (current) => {
      if (!current) { router.replace("/login"); return; }
      setUser(current);
      await load(current);
    });
  }, [router]);

  function resetForm() {
    setEditing(null); setName(""); setShift("Manhã"); setSubjects(""); setLatitude(""); setLongitude(""); setRadius("100"); setRemoveLocation(false);
  }

  function editClass(schoolClass: SchoolClass) {
    setEditing(schoolClass);
    setName(schoolClass.name);
    setShift(schoolClass.shift);
    setSubjects(schoolClass.subjects.join(", "));
    setLatitude(schoolClass.location ? String(schoolClass.location.latitude) : "");
    setLongitude(schoolClass.location ? String(schoolClass.location.longitude) : "");
    setRadius(String(schoolClass.location?.radiusMeters ?? 100));
    setRemoveLocation(false);
    document.getElementById("class-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) { setError("Este navegador não oferece localização."); return; }
    setLocating(true); setError("");
    navigator.geolocation.getCurrentPosition((result) => {
      setLatitude(result.coords.latitude.toFixed(6));
      setLongitude(result.coords.longitude.toFixed(6));
      setRemoveLocation(false);
      setNotice("Localização atual preenchida.");
      setLocating(false);
    }, () => { setError("Não foi possível obter a localização."); setLocating(false); }, { enableHighAccuracy: true, timeout: 12000 });
  }

  async function saveClass(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    if (Boolean(latitude) !== Boolean(longitude)) { setError("Preencha latitude e longitude juntas ou deixe as duas vazias."); return; }
    setBusy(true); setError(""); setNotice("");
    const location: RoomLocation | null | undefined = removeLocation
      ? null
      : latitude && longitude
        ? { latitude: Number(latitude), longitude: Number(longitude), radiusMeters: Number(radius) }
        : undefined;
    const body = {
      name,
      shift,
      subjects: subjects.split(",").map((item) => item.trim()).filter(Boolean),
      ...(location !== undefined ? { location } : {})
    };
    try {
      if (editing) {
        await apiRequest(user, `/classes/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
        setNotice(`Turma ${name} atualizada.`);
      } else {
        await apiRequest(user, "/classes", { method: "POST", body: JSON.stringify(body) });
        setNotice(`Turma ${name} cadastrada.`);
      }
      resetForm();
      await load(user);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar a turma."); }
    finally { setBusy(false); }
  }

  async function deleteClass(schoolClass: SchoolClass) {
    if (!user || !window.confirm(`Excluir a turma “${schoolClass.name}”? Ela será arquivada para preservar aulas, frequências e protocolos já registrados.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(user, `/classes/${schoolClass.id}`, { method: "DELETE" });
      if (editing?.id === schoolClass.id) resetForm();
      setNotice(`Turma ${schoolClass.name} excluída e arquivada. O histórico foi preservado.`);
      await load(user);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível excluir a turma."); }
    finally { setBusy(false); }
  }

  return <main className="app-shell"><AppSidebar profile={profile} active="school-classes" /><section className="workspace">
    <header className="topbar"><div className="breadcrumbs">Educonnect <span>/</span> Gestão escolar <span>/</span> Turmas</div><span className="role-chip">{classes.length} turmas</span></header>
    <div className="page-content">
      <div className="greeting-row"><div><p className="eyebrow">GESTÃO ESCOLAR</p><h1>Turmas</h1><p className="subtitle">Edite turmas, disciplinas e uma localização de referência opcional.</p></div></div>
      {error && <div className="notice" role="alert"><span>ⓘ</span><div>{error}</div></div>}
      {notice && <div className="success-note" role="status">✓ {notice}</div>}
      <section className="coord-section"><div className="section-heading"><div><h2>Turmas ativas</h2><p>A localização da turma é opcional. O professor escolhe o local usado em cada chamada.</p></div></div>
        {loading ? <div className="card loading-card"><span className="spinner blue-spinner" />Carregando turmas...</div> : classes.length ? <div className="class-summary-grid">{classes.map((schoolClass) => <article className="class-summary-card class-management-card" key={schoolClass.id}>
          <div className="class-summary-head"><div className="class-avatar">{schoolClass.name.slice(0, 2).toUpperCase()}</div><a className="class-arrow" href={`/classes/${schoolClass.id}`} aria-label={`Abrir ${schoolClass.name}`}>↗</a></div>
          <h3><a href={`/classes/${schoolClass.id}`}>{schoolClass.name}</a></h3>
          <p>{schoolClass.shift} · {schoolClass.studentCount ?? schoolClass.studentIds?.length ?? 0} estudantes</p>
          <div className="class-subjects">{schoolClass.subjects.map((item) => <span key={item}>{item}</span>)}</div>
          {schoolClass.location && <small className="class-location-note">Local de referência cadastrado · raio {schoolClass.location.radiusMeters} m</small>}
          <div className="class-management-actions"><button className="outline-button" type="button" onClick={() => editClass(schoolClass)}>Editar turma</button><button className="outline-button danger-outline" type="button" disabled={busy} onClick={() => void deleteClass(schoolClass)}>Excluir</button></div>
        </article>)}</div> : <div className="empty-inline card">Nenhuma turma ativa cadastrada. Use o formulário para criar a primeira.</div>}
      </section>
      <section id="class-form" className="coord-section"><div className="section-heading"><div><h2>{editing ? "Editar turma" : "Cadastrar turma"}</h2><p>Atualize nome, turno, disciplinas e localização de referência da turma.</p></div>{editing && <button className="outline-button" type="button" onClick={resetForm}>Cancelar edição</button>}</div>
        <form className="card management-form" onSubmit={saveClass}><div className="form-grid">
          <label>Nome da turma<input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: 2º B — Desenvolvimento de Sistemas" /></label>
          <label>Turno<select value={shift} onChange={(event) => setShift(event.target.value)}><option>Manhã</option><option>Tarde</option><option>Noite</option><option>Integral</option></select></label>
          <label className="span-two">Disciplinas<input required value={subjects} onChange={(event) => setSubjects(event.target.value)} placeholder="Matemática, Português, Desenvolvimento Web" /><small>Separe as disciplinas com vírgulas.</small></label>
          <div className="location-label span-two"><div><strong>Localização de referência (opcional)</strong><small>O professor pode usar sua localização atual ou selecionar um Ambiente ao preparar a chamada.</small></div><button className="outline-button" type="button" disabled={locating} onClick={useCurrentLocation}>⌖ {locating ? "Obtendo localização..." : "Usar localização atual"}</button></div>
          <label>Latitude<input type="number" step="any" min="-90" max="90" value={latitude} onChange={(event) => { setLatitude(event.target.value); setRemoveLocation(false); }} placeholder="-8.2832" /></label>
          <label>Longitude<input type="number" step="any" min="-180" max="180" value={longitude} onChange={(event) => { setLongitude(event.target.value); setRemoveLocation(false); }} placeholder="-34.9230" /></label>
          <label>Raio permitido (metros)<input type="number" min="20" max="1000" value={radius} onChange={(event) => setRadius(event.target.value)} disabled={!latitude || !longitude || removeLocation} /></label>
          {editing && editing.location && <div className="span-two"><button className="outline-button danger-outline" type="button" onClick={() => { setLatitude(""); setLongitude(""); setRemoveLocation(true); }}>Remover localização da turma</button>{removeLocation && <small> A localização será removida ao salvar.</small>}</div>}
        </div><div className="form-actions"><p>Excluir uma turma a arquiva e preserva o histórico de chamadas, frequências e protocolos.</p><button className="primary-link" disabled={busy}>{busy ? "Salvando..." : editing ? "Salvar alterações" : "Salvar turma"}</button></div></form>
      </section>
      <footer className="app-footer"><span>© 2026 Educonnect</span><span>Gestão escolar, mais próxima.</span></footer>
    </div>
  </section></main>;
}
