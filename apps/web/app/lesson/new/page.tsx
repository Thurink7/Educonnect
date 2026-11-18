"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import type { ClassroomEnvironment, RoomLocation, SchoolClass, UserProfile } from "@educonnect/shared";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { apiRequest } from "@/lib/api";
import { auth } from "@/lib/firebase";

interface CreatedLesson {
  lesson: { id: string; subject: string; classId: string; qrExpiresAt: string };
  qrDataUrl: string;
  expiresAt?: string;
}

export default function NewLessonPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [environments, setEnvironments] = useState<ClassroomEnvironment[]>([]);
  const [classId, setClassId] = useState("");
  const [subject, setSubject] = useState("");
  const [mode, setMode] = useState<"in-person" | "remote">("in-person");
  const [locationMode, setLocationMode] = useState<"current" | "environment">("current");
  const [currentLocation, setCurrentLocation] = useState<RoomLocation | null>(null);
  const [radius, setRadius] = useState("100");
  const [environmentId, setEnvironmentId] = useState("");
  const [lesson, setLesson] = useState<CreatedLesson | null>(null);
  const [qrData, setQrData] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [remaining, setRemaining] = useState(0);

  const classEnvironments = useMemo(
    () => environments.filter((item) => item.classId === classId),
    [environments, classId]
  );
  const selectedClass = classes.find((item) => item.id === classId);

  async function refreshQr(current: User, lessonId: string) {
    try {
      const next = await apiRequest<{ qrDataUrl: string; expiresAt: string }>(current, `/lessons/${lessonId}/qr`, { method: "POST" });
      setQrData(next.qrDataUrl);
      setExpiresAt(next.expiresAt);
      setError("");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível atualizar o QR Code.");
      return false;
    }
  }

  useEffect(() => {
    if (!auth) { router.replace("/login"); return; }
    return onAuthStateChanged(auth, async (current) => {
      if (!current) { router.replace("/login"); return; }
      setUser(current);
      try {
        const [me, classData, environmentData] = await Promise.all([
          apiRequest<{ user: UserProfile }>(current, "/me"),
          apiRequest<{ classes: SchoolClass[] }>(current, "/classes"),
          apiRequest<{ environments: ClassroomEnvironment[] }>(current, "/environments")
        ]);
        setProfile(me.user);
        setClasses(classData.classes);
        setEnvironments(environmentData.environments);
        const initialClass = new URLSearchParams(window.location.search).get("classId");
        const firstClass = classData.classes.find((item) => item.id === initialClass) ?? classData.classes[0];
        if (firstClass) {
          setClassId(firstClass.id);
          setSubject(firstClass.subjects[0] ?? "");
          const firstEnvironment = environmentData.environments.find((item) => item.classId === firstClass.id);
          if (firstEnvironment) { setLocationMode("environment"); setEnvironmentId(firstEnvironment.id); }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Não foi possível carregar as turmas e os ambientes.");
      } finally { setLoading(false); }
    });
  }, [router]);

  useEffect(() => {
    if (!lesson || !user) return;
    const expiryTime = new Date(expiresAt || lesson.lesson.qrExpiresAt).getTime();
    const tick = () => setRemaining(Math.max(0, Math.ceil((expiryTime - Date.now()) / 1000)));
    tick();
    const countdown = window.setInterval(tick, 250);
    let retry: number | undefined;
    let cancelled = false;
    const refresh = async () => {
      const ok = await refreshQr(user, lesson.lesson.id);
      if (!ok && !cancelled) retry = window.setTimeout(() => void refresh(), 5000);
    };
    const rotate = window.setTimeout(() => void refresh(), Math.max(1000, expiryTime - Date.now() - 1600));
    return () => {
      cancelled = true;
      window.clearInterval(countdown);
      window.clearTimeout(rotate);
      if (retry) window.clearTimeout(retry);
    };
  }, [lesson, user, expiresAt]);

  function captureCurrentLocation(): Promise<RoomLocation> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error("Este navegador não oferece localização.")); return; }
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (result) => {
          const location = { latitude: result.coords.latitude, longitude: result.coords.longitude, radiusMeters: Number(radius) || 100 };
          setCurrentLocation(location);
          setLocating(false);
          resolve(location);
        },
        () => { setLocating(false); reject(new Error("Não foi possível obter sua localização. Permita o acesso à localização e tente novamente.")); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError("");
    setLesson(null);
    try {
      let location: RoomLocation | undefined;
      let selectedEnvironmentId: string | undefined;
      if (mode === "in-person" && locationMode === "current") {
        if (!currentLocation) throw new Error("Obtenha sua localização atual antes de gerar o QR Code.");
        location = { ...currentLocation, radiusMeters: Number(radius) };
      } else if (mode === "in-person") {
        const environment = classEnvironments.find((item) => item.id === environmentId);
        if (!environment) throw new Error("Selecione um ambiente predefinido para esta turma.");
        selectedEnvironmentId = environment.id;
      }
      const result = await apiRequest<CreatedLesson>(user, "/lessons", {
        method: "POST",
        body: JSON.stringify({ classId, subject, mode, locationMode, ...(location ? { location } : {}), ...(selectedEnvironmentId ? { environmentId: selectedEnvironmentId } : {}) })
      });
      setLesson(result);
      setQrData(result.qrDataUrl);
      setExpiresAt(result.expiresAt ?? result.lesson.qrExpiresAt);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível abrir a aula."); }
    finally { setBusy(false); }
  }

  async function close() {
    if (!user || !lesson) return;
    setBusy(true);
    try {
      await apiRequest(user, `/lessons/${lesson.lesson.id}/close`, { method: "POST" });
      router.push(`/classes/${lesson.lesson.classId}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível encerrar a aula."); }
    finally { setBusy(false); }
  }

  return <main className="app-shell"><AppSidebar profile={profile} active="lesson" /><section className="workspace"><div className="flow-page">
    <a className="back-link" href="/dashboard">← Voltar ao painel</a>
    <section className="flow-card">
      <div className="welcome-icon">▣</div>
      <p className="eyebrow">FREQUÊNCIA DIGITAL · {profile?.role === "coordination" ? "COORDENAÇÃO" : "PROFESSOR"}</p>
      <h1>Prepare sua aula</h1>
      <p className="subtitle flow-subtitle">Escolha turma e disciplina. Para aulas presenciais, use sua localização atual ou um ambiente cadastrado.</p>
      {loading ? <div className="loading-card"><span className="spinner blue-spinner" />Carregando turmas e ambientes...</div> : !lesson ? <form className="flow-form" onSubmit={create}>
        <label htmlFor="class">Turma</label>
        <select id="class" required value={classId} onChange={(event) => {
          const nextClassId = event.target.value;
          setClassId(nextClassId);
          setSubject(classes.find((item) => item.id === nextClassId)?.subjects[0] ?? "");
          setEnvironmentId("");
          setCurrentLocation(null);
          setLocationMode(environments.some((item) => item.classId === nextClassId) ? "environment" : "current");
        }}>
          <option value="" disabled>Selecione a turma</option>
          {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <label htmlFor="subject">Disciplina</label>
        <select id="subject" required value={subject} onChange={(event) => setSubject(event.target.value)}>
          <option value="" disabled>Selecione a disciplina</option>
          {selectedClass?.subjects.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <label htmlFor="mode">Formato da aula</label>
        <select id="mode" value={mode} onChange={(event) => setMode(event.target.value as "in-person" | "remote")}>
          <option value="in-person">Presencial</option><option value="remote">Remota</option>
        </select>
        {mode === "in-person" && <>
          <label htmlFor="location-mode">Localização para validar a presença</label>
          <select id="location-mode" value={locationMode} onChange={(event) => setLocationMode(event.target.value as "current" | "environment")}>
            <option value="current">Usar minha localização atual</option>
            <option value="environment">Usar ambiente predefinido</option>
          </select>
          {locationMode === "current" ? <>
            <div className="location-label"><div><strong>Local da aula</strong><small>{currentLocation ? `${currentLocation.latitude.toFixed(6)}, ${currentLocation.longitude.toFixed(6)}` : "Obtenha as coordenadas neste dispositivo antes de iniciar."}</small></div>
              <button className="outline-button" type="button" disabled={locating || busy} onClick={() => { setError(""); void captureCurrentLocation().catch((reason: Error) => setError(reason.message)); }}>⌖ {locating ? "Obtendo localização..." : currentLocation ? "Atualizar localização" : "Obter localização atual"}</button>
            </div>
            <label>Raio permitido (metros)<input type="number" min="20" max="1000" value={radius} onChange={(event) => setRadius(event.target.value)} required /></label>
          </> : <>
            <label htmlFor="environment">Ambiente</label>
            <select id="environment" required value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}>
              <option value="">Selecione uma sala predefinida</option>
              {classEnvironments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            {environmentId && <p className="hint">A chamada usará a localização e o raio cadastrados para este ambiente.</p>}
            {!classEnvironments.length && <p className="hint">Não há ambientes cadastrados para esta turma. {profile?.role === "coordination" ? <a href="/coordination/environments">Cadastrar ambiente</a> : "Peça à coordenação para cadastrar uma sala."}</p>}
          </>}
        </>}
        {mode === "remote" && <p className="hint">A chamada por QR é presencial. Para aulas remotas, use a chamada manual.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={busy || !classes.length || mode === "remote" || (locationMode === "environment" && mode === "in-person" && !classEnvironments.length)}>
          {busy ? <><span className="spinner" />Preparando...</> : <>Iniciar aula e gerar QR <span>→</span></>}
        </button>
      </form> : <div className="qr-result">
        <div className={`qr-timer ${remaining === 0 ? "expired" : ""}`}><span className="live-dot" />{remaining > 0 ? `QR Code atualiza em ${remaining} segundos` : "Atualizando código..."}</div>
        {qrData && <img src={qrData} alt="QR Code dinâmico para registrar presença" />}
        <strong>{lesson.lesson.subject}</strong>
        <p>{selectedClass?.name}. O código gira automaticamente; mantenha esta tela aberta para registrar a presença.</p>
        {error && <div className="scan-error" role="alert">{error}<button type="button" onClick={() => user && void refreshQr(user, lesson.lesson.id)}>Tentar atualizar o QR Code</button></div>}
        <a className="outline-button" href={`/classes/${lesson.lesson.classId}`}>Abrir chamada manual</a>
        <button className="danger-button wide-danger" disabled={busy} onClick={() => void close()}>{busy ? "Encerrando…" : "Encerrar aula e finalizar chamada"}</button>
      </div>}
    </section>
  </div></section></main>;
}
