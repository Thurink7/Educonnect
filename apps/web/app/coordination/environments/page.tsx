"use client";

import { FormEvent, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import type { ClassroomEnvironment, RoomLocation, SchoolClass, UserProfile } from "@educonnect/shared";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { apiRequest } from "@/lib/api";
import { auth } from "@/lib/firebase";

type TimeSlot = { weekday: number; startsAt: string; endsAt: string };
const weekdays = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const blankSlot = (): TimeSlot => ({ weekday: 1, startsAt: "07:30", endsAt: "09:10" });

export default function CoordinationEnvironmentsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [environments, setEnvironments] = useState<ClassroomEnvironment[]>([]);
  const [editing, setEditing] = useState<ClassroomEnvironment | null>(null);
  const [name, setName] = useState("");
  const [classId, setClassId] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState("100");
  const [schedule, setSchedule] = useState<TimeSlot[]>([blankSlot()]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(current: User) {
    try {
      const [me, classData, environmentData] = await Promise.all([
        apiRequest<{ user: UserProfile }>(current, "/me"),
        apiRequest<{ classes: SchoolClass[] }>(current, "/classes"),
        apiRequest<{ environments: ClassroomEnvironment[] }>(current, "/environments")
      ]);
      if (me.user.role !== "coordination") { router.replace("/dashboard"); return; }
      setProfile(me.user);
      setClasses(classData.classes);
      setEnvironments(environmentData.environments);
      if (!classId && classData.classes[0]) setClassId(classData.classes[0].id);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar os ambientes."); }
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
    setEditing(null); setName(""); setLatitude(""); setLongitude(""); setRadius("100"); setSchedule([blankSlot()]);
    if (classes[0]) setClassId(classes[0].id);
  }

  function editEnvironment(environment: ClassroomEnvironment) {
    setEditing(environment);
    setName(environment.name);
    setClassId(environment.classId);
    setLatitude(String(environment.location.latitude));
    setLongitude(String(environment.location.longitude));
    setRadius(String(environment.location.radiusMeters));
    setSchedule(environment.schedule.length ? environment.schedule.map((item) => ({ ...item })) : [blankSlot()]);
    document.getElementById("environment-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) { setError("Este navegador não oferece localização."); return; }
    setLocating(true); setError("");
    navigator.geolocation.getCurrentPosition((result) => {
      setLatitude(result.coords.latitude.toFixed(6));
      setLongitude(result.coords.longitude.toFixed(6));
      setNotice("Localização capturada para este ambiente.");
      setLocating(false);
    }, () => { setError("Não foi possível obter a localização. Permita o acesso à localização e tente novamente."); setLocating(false); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setBusy(true); setError(""); setNotice("");
    const body = { name, classId, schedule, location: { latitude: Number(latitude), longitude: Number(longitude), radiusMeters: Number(radius) } satisfies RoomLocation };
    try {
      if (editing) {
        await apiRequest(user, `/environments/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
        setNotice(`Ambiente ${name} atualizado.`);
      } else {
        await apiRequest(user, "/environments", { method: "POST", body: JSON.stringify(body) });
        setNotice(`Ambiente ${name} cadastrado.`);
      }
      resetForm();
      await load(user);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar o ambiente."); }
    finally { setBusy(false); }
  }

  async function remove(environment: ClassroomEnvironment) {
    if (!user || !window.confirm(`Excluir o ambiente “${environment.name}”? A localização já gravada em aulas existentes será preservada.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(user, `/environments/${environment.id}`, { method: "DELETE" });
      if (editing?.id === environment.id) resetForm();
      setNotice(`Ambiente ${environment.name} excluído.`);
      await load(user);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível excluir o ambiente."); }
    finally { setBusy(false); }
  }

  function updateSlot(index: number, key: keyof TimeSlot, value: string) {
    setSchedule((current) => current.map((slot, slotIndex) => slotIndex === index ? { ...slot, [key]: key === "weekday" ? Number(value) : value } : slot));
  }

  return <main className="app-shell"><AppSidebar profile={profile} active="environments" /><section className="workspace">
    <header className="topbar"><div className="breadcrumbs">Educonnect <span>/</span> Gestão escolar <span>/</span> Ambientes</div><span className="role-chip">{environments.length} ambientes</span></header>
    <div className="page-content">
      <div className="greeting-row"><div><p className="eyebrow">GESTÃO ESCOLAR</p><h1>Ambientes</h1><p className="subtitle">Cadastre salas, horários, turmas vinculadas e uma localização que o professor pode reutilizar.</p></div></div>
      {error && <div className="notice" role="alert"><span>ⓘ</span><div>{error}</div></div>}
      {notice && <div className="success-note" role="status">✓ {notice}</div>}
      <section className="coord-section"><div className="section-heading"><div><h2>Ambientes cadastrados</h2><p>A localização predefinida é apenas uma opção; o professor pode capturar a localização atual ao preparar a aula.</p></div></div>
        {loading ? <div className="card loading-card"><span className="spinner blue-spinner" />Carregando ambientes...</div> : environments.length ? <div className="environment-list">{environments.map((environment) => {
          const linkedClass = classes.find((item) => item.id === environment.classId);
          return <article className="environment-card card" key={environment.id}>
            <div className="environment-card-main"><div className="class-avatar">⌂</div><div><h3>{environment.name}</h3><p>{linkedClass?.name ?? "Turma não encontrada"} · raio {environment.location.radiusMeters} m</p></div></div>
            <div className="environment-schedule">{environment.schedule.length ? environment.schedule.map((slot, index) => <span key={`${slot.weekday}-${slot.startsAt}-${index}`}>{weekdays[slot.weekday]} · {slot.startsAt}–{slot.endsAt}</span>) : <span>Sem horário predefinido</span>}</div>
            <div className="environment-actions"><button className="outline-button" type="button" onClick={() => editEnvironment(environment)}>Editar</button><button className="outline-button danger-outline" type="button" disabled={busy} onClick={() => void remove(environment)}>Excluir</button></div>
          </article>;
        })}</div> : <div className="empty-inline card">Nenhum ambiente cadastrado ainda.</div>}
      </section>
      <section id="environment-form" className="coord-section"><div className="section-heading"><div><h2>{editing ? "Editar ambiente" : "Cadastrar ambiente"}</h2><p>Vincule a sala a uma turma e guarde uma localização para agilizar a abertura da chamada.</p></div>{editing && <button className="outline-button" type="button" onClick={resetForm}>Cancelar edição</button>}</div>
        <form className="card management-form" onSubmit={submit}><div className="form-grid">
          <label>Nome da sala<input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Laboratório 2" /></label>
          <label>Turma vinculada<select required value={classId} onChange={(event) => setClassId(event.target.value)}><option value="">Selecione a turma</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div className="location-label span-two"><div><strong>Localização predefinida</strong><small>Capturada no local da sala. O professor ainda poderá usar a localização atual ao preparar a aula.</small></div><button className="outline-button" type="button" disabled={locating} onClick={useCurrentLocation}>⌖ {locating ? "Obtendo localização..." : "Usar localização atual"}</button></div>
          <label>Latitude<input type="number" step="any" required min="-90" max="90" value={latitude} onChange={(event) => setLatitude(event.target.value)} placeholder="-8.2832" /></label>
          <label>Longitude<input type="number" step="any" required min="-180" max="180" value={longitude} onChange={(event) => setLongitude(event.target.value)} placeholder="-34.9230" /></label>
          <label>Raio permitido (metros)<input type="number" required min="20" max="1000" value={radius} onChange={(event) => setRadius(event.target.value)} /></label>
        </div>
        <div className="environment-time-editor"><div className="section-heading"><div><h3>Horários de aula</h3><p>Adicione os horários recorrentes em que a sala é usada.</p></div><button type="button" className="outline-button" onClick={() => setSchedule((current) => [...current, blankSlot()])}>＋ Adicionar horário</button></div>
          {schedule.map((slot, index) => <div className="environment-time-row" key={index}>
            <label>Dia<select value={slot.weekday} onChange={(event) => updateSlot(index, "weekday", event.target.value)}>{weekdays.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}</select></label>
            <label>Início<input type="time" required value={slot.startsAt} onChange={(event) => updateSlot(index, "startsAt", event.target.value)} /></label>
            <label>Fim<input type="time" required value={slot.endsAt} onChange={(event) => updateSlot(index, "endsAt", event.target.value)} /></label>
            <button type="button" className="outline-button danger-outline" aria-label="Remover horário" disabled={schedule.length === 1} onClick={() => setSchedule((current) => current.filter((_, slotIndex) => slotIndex !== index))}>Remover</button>
          </div>)}
        </div>
        <div className="form-actions"><p>Os horários ajudam a coordenação e não substituem a abertura da chamada pelo professor.</p><button className="primary-link" disabled={busy || loading || !classes.length}>{busy ? "Salvando..." : editing ? "Salvar alterações" : "Cadastrar ambiente"}</button></div>
        </form>
      </section>
      <footer className="app-footer"><span>© 2026 Educonnect</span><span>Gestão escolar, mais próxima.</span></footer>
    </div>
  </section></main>;
}
