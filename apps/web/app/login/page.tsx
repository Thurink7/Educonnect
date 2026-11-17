"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { browserSessionPersistence, setPersistence, signInWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";
import { auth, firebaseConfigured } from "@/lib/firebase";
import { Brand } from "@/components/brand";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (!auth) { setError("Configure as variáveis NEXT_PUBLIC_FIREBASE no arquivo .env.local para habilitar o acesso."); return; }
    setLoading(true);
    try { await setPersistence(auth, browserSessionPersistence); await signInWithEmailAndPassword(auth, email, password); router.push("/dashboard"); }
    catch { setError("Não foi possível entrar. Confira seu e-mail e senha ou peça acesso à coordenação."); }
    finally { setLoading(false); }
  }

  return <main className="login-page">
    <section className="login-visual" aria-label="Estudantes chegando à escola">
      <Image src="/images/hero-login.webp" alt="Estudantes caminhando em direção à escola" fill priority sizes="(max-width: 760px) 100vw, 52vw" className="login-hero-image" />
      <div className="login-hero-overlay" />
      <div className="login-visual-content">
        <Brand  href="/login" className="login-brand" />
        <div className="login-hero-copy"><h1>O futuro começa quando a gente caminha junto.</h1><p>Uma comunidade escolar mais próxima, presente e preparada para crescer.</p></div>
        <div className="hero-bottom"><span>Educonnect</span><span className="hero-bottom-line"/><span>Aprender · Conectar · Evoluir</span></div>
      </div>
      
    </section>
    <section className="login-panel">
      <div className="login-top"><Brand href="/login" className="login-mobile-brand"/></div>
      <div className="login-content">
        <p className="eyebrow">BEM-VINDO AO EDUCONNECT</p><h2>Seu próximo passo<br/><span>começa por aqui.</span></h2><p className="login-intro">Acesse sua conta para acompanhar sua jornada.</p>
        <form onSubmit={submit} className="login-form">
          <label htmlFor="email">E-mail</label><div className="input-wrap"><span className="input-icon">＠</span><input id="email" autoComplete="username" required type="email" placeholder="voce@escola.com.br" value={email} onChange={e=>setEmail(e.target.value)}/></div>
          <div className="password-label"><label htmlFor="password">Senha</label><a href="mailto:coordenacao@educonnect.local?subject=Recuperar%20acesso">Esqueceu a senha?</a></div><div className="input-wrap"><span className="input-icon">⌑</span><input id="password" autoComplete="current-password" required type="password" placeholder="Digite sua senha" value={password} onChange={e=>setPassword(e.target.value)}/></div>
          {error&&<p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={loading}>{loading?<><span className="spinner"/>Entrando...</>:<>Entrar na plataforma <span>→</span></>}</button>
        </form>
        <div className="login-divider"><span/> NOVO POR AQUI? <span/></div>
        <a className="request-access" href="mailto:coordenacao@educonnect.local?subject=Solicitar%20acesso">Solicitar acesso à coordenação <span>↗</span></a>
      </div>
      <p className="panel-footer"><span>© 2026 Educonnect</span><span>Feito para aproximar.</span></p>
    </section>
  </main>;
}
