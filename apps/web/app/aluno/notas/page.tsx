"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import type { StudentReportCardEntry, UserProfile } from "@educonnect/shared";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { apiRequest } from "@/lib/api";
import { auth } from "@/lib/firebase";

export default function StudentGradesPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [grades, setGrades] = useState<StudentReportCardEntry[]>([]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!auth) { router.replace("/login"); return; }
    return onAuthStateChanged(auth, async (current) => {
      if (!current) { router.replace("/login"); return; }
      setUser(current);
      try {
        const [me, result] = await Promise.all([
          apiRequest<{ user: UserProfile }>(current, "/me"),
          apiRequest<{ grades: StudentReportCardEntry[] }>(current, "/grade-submissions/report-card")
        ]);
        if (me.user.role !== "student") { router.replace("/dashboard"); return; }
        setProfile(me.user);
        setGrades(result.grades);
      } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar o boletim."); }
      finally { setLoading(false); }
    });
  }, [router]);

  const years = [...new Set(grades.map((item) => item.academicYear))].sort((a, b) => b.localeCompare(a));
  const visibleGrades = grades.filter((item) => item.academicYear === year);
  const groups = useMemo(() => {
    const grouped = new Map<string, StudentReportCardEntry[]>();
    for (const item of visibleGrades) {
      const key = `${item.term} · ${item.subject}`;
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return [...grouped.entries()];
  }, [visibleGrades]);

  return <main className="app-shell"><AppSidebar profile={profile} active="student-grades" /><section className="workspace">
    <header className="topbar"><div className="breadcrumbs">Educonnect <span>/</span> Meu aprendizado <span>/</span> Boletim</div><span className="role-chip">Boletim online</span></header>
    <div className="page-content">
      <div className="greeting-row"><div><p className="eyebrow">ACOMPANHAMENTO ACADÊMICO</p><h1>Meu boletim</h1><p className="subtitle">Aqui aparecem apenas notas revisadas e publicadas pela Coordenação.</p></div>
        <label className="period-filter">Ano letivo<select value={year} onChange={(event) => setYear(event.target.value)}>{years.includes(year) || !years.length ? null : <option value={year}>{year}</option>}{years.length ? years.map((item) => <option key={item} value={item}>{item}</option>) : <option value={String(new Date().getFullYear())}>{new Date().getFullYear()}</option>}</select></label>
      </div>
      {error && <div className="notice" role="alert"><span>ⓘ</span><div>{error}</div></div>}
      {loading ? <div className="card loading-card"><span className="spinner blue-spinner" />Carregando boletim...</div> : groups.length ? <div className="grade-report-list">{groups.map(([group, entries]) => <section className="card grade-report-card" key={group}>
        <div className="section-heading"><div><h2>{group}</h2><p>{entries[0].className} · {year}</p></div></div>
        <div className="table-scroll"><table className="academic-table"><thead><tr><th>Professor</th>{entries[0].gradeLabels.map((label, index) => <th key={`${label}-${index}`}>{label}</th>)}<th>Média final</th><th>Situação</th></tr></thead>
          <tbody>{entries.map((entry) => <tr key={entry.id}><td>{entry.teacherName}</td>{entry.gradeLabels.map((label, index) => <td key={`${entry.id}-${label}-${index}`}>{entry.partialGrades[index] === null ? "—" : entry.partialGrades[index].toFixed(1)}</td>)}<td><strong>{entry.average.toFixed(1)}</strong></td><td><span className={`academic-status ${entry.average >= 7 ? "approved" : "recovery"}`}>{entry.average >= 7 ? "Aprovado" : "Em recuperação"}</span></td></tr>)}</tbody>
        </table></div>
      </section>)}</div> : <div className="empty-state card"><div className="empty-icon">▤</div><h3>Nenhuma nota publicada ainda</h3><p>As notas aparecerão aqui depois que o professor enviar o lançamento e a Coordenação aprová-lo.</p></div>}
      <footer className="app-footer"><span>© 2026 Educonnect</span><span>Seu aprendizado, acompanhado.</span></footer>
    </div>
  </section></main>;
}
