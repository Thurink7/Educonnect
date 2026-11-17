"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import type { UserProfile } from "@educonnect/shared";
import { auth } from "@/lib/firebase";
import { Brand } from "@/components/brand";

type MenuLink = { label: string; href: string; icon: string; active: string };
const studentLinks: Array<{ group: string; links: MenuLink[] }> = [
  { group: "INÍCIO", links: [{ label: "Visão geral", href: "/dashboard", icon: "⌂", active: "overview" }] },
  { group: "MINHA ROTINA", links: [
    { label: "Registrar presença", href: "/scan", icon: "◉", active: "scan" },
    { label: "Meu histórico", href: "/attendance", icon: "◷", active: "attendance" },
    { label: "Protocolos", href: "/protocols", icon: "▤", active: "protocols" }
  ] }
];
const teacherLinks: Array<{ group: string; links: MenuLink[] }> = [
  { group: "INÍCIO", links: [{ label: "Visão geral", href: "/dashboard", icon: "⌂", active: "overview" }] },
  { group: "ENSINO", links: [
    { label: "Minhas turmas", href: "/classes", icon: "▦", active: "classes" },
    { label: "Preparar aula", href: "/lesson/new", icon: "◷", active: "lesson" }
  ] }
];
const coordinationLinks: Array<{ group: string; links: MenuLink[] }> = [
  { group: "INÍCIO", links: [{ label: "Visão geral", href: "/dashboard", icon: "⌂", active: "overview" }] },
  { group: "GESTÃO ESCOLAR", links: [
    { label: "Acompanhamento", href: "/coordination", icon: "▥", active: "coordination" },
    { label: "Turmas", href: "/coordination/classes", icon: "▦", active: "school-classes" },
    { label: "Pessoas", href: "/coordination/people", icon: "♙", active: "people" },
    { label: "Alertas e protocolos", href: "/coordination/protocols", icon: "♧", active: "school-protocols" }
  ] }
];

export function AppSidebar({ profile, active }: { profile: UserProfile | null; active: string }) {
  const router = useRouter();
  const links = profile?.role === "coordination" ? coordinationLinks : profile?.role === "teacher" ? teacherLinks : studentLinks;
  const roleLabel = profile?.role === "coordination" ? "Coordenação" : profile?.role === "teacher" ? "Professor" : "Estudante";

  async function logout() {
    if (auth) await signOut(auth);
    router.replace("/login");
  }

  return <aside className="sidebar">
    <Brand className="sidebar-brand" />
    <div className="side-profile">
      <div className="avatar">{profile?.displayName?.slice(0, 1) || "E"}</div>
      <div className="profile-copy"><strong>{profile?.displayName || "Carregando..."}</strong><small>{roleLabel}</small></div>
    </div>
    <nav className="sidebar-navigation" aria-label="Navegação principal">
      {links.map((section) => <div className="nav-section" key={section.group}>
        <p className="nav-caption">{section.group}</p>
        {section.links.map((item) => <Link key={item.active} className={`nav-item ${active === item.active ? "selected" : ""}`} href={item.href}>
          <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
        </Link>)}
      </div>)}
    </nav>
    <div className="sidebar-bottom">
      <div className="help-card"><div className="help-symbol">?</div><strong>Precisa de ajuda?</strong><p>Fale com a equipe de suporte.</p><a href="mailto:suporte@educonnect.local">Falar com suporte <span>→</span></a></div>
      <button className="nav-item logout" onClick={() => void logout()}><span className="nav-icon">↪</span>Sair desta sessão</button>
    </div>
  </aside>;
}
