"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { auth } from "@/lib/firebase";

type Protocol={id:string;title:string;description:string;className:string;status:"open"|"sent"|"resolved";dueAt?:string;createdAt:string};
export default function ProtocolsPage(){const router=useRouter();const[user,setUser]=useState<User|null>(null);const[items,setItems]=useState<Protocol[]>([]);const[error,setError]=useState("");const[loading,setLoading]=useState(true);const[busy,setBusy]=useState("");
 async function load(current:User){setLoading(true);try{const data=await apiRequest<{protocols:Protocol[]}>(current,"/protocols");setItems(data.protocols);}catch(e){setError(e instanceof Error?e.message:"Não foi possível consultar os protocolos.");}finally{setLoading(false);}}
 useEffect(()=>{if(!auth){router.replace("/login");return;}return onAuthStateChanged(auth,current=>{if(!current){router.replace("/login");return;}setUser(current);void load(current);});},[router]);
 async function resolve(id:string){if(!user)return;setBusy(id);try{await apiRequest(user,`/protocols/${id}/resolve`,{method:"PATCH"});await load(user);}catch(e){setError(e instanceof Error?e.message:"Não foi possível atualizar o protocolo.");}finally{setBusy("");}}
 return <main className="app-shell"><AppSidebar profile={null} active="protocols" /><section className="workspace"><header className="topbar"><div className="breadcrumbs">Educonnect <span>/</span> Protocolos</div></header><div className="page-content"><div className="greeting-row"><div><p className="eyebrow">ACOMPANHAMENTO PEDAGÓGICO</p><h1>Meus protocolos</h1><p className="subtitle">Orientações e combinados registrados pela coordenação.</p></div></div>{error&&<div className="notice" role="alert"><span>ⓘ</span><div>{error}</div></div>}{loading?<div className="card loading-card"><span className="spinner blue-spinner"/>Carregando protocolos...</div>:items.length?<div className="protocol-list">{items.map(item=><article className="card protocol-card" key={item.id}><div className="protocol-card-heading"><div><span className={`protocol-status ${item.status}`}>{item.status==="resolved"?"Concluído":"Em acompanhamento"}</span><h2>{item.title}</h2><p>{item.className} · Criado em {new Date(item.createdAt).toLocaleDateString("pt-BR")}</p></div><span className="protocol-symbol">▤</span></div><p className="protocol-description">{item.description}</p>{item.status!=="resolved"&&<button className="outline-button" disabled={busy===item.id} onClick={()=>void resolve(item.id)}>{busy===item.id?"Salvando...":"Marcar como concluído"}</button>}</article>)}</div>:<div className="empty-state card"><div className="empty-icon">✓</div><h3>Você está em dia</h3><p>Não há protocolos pedagógicos cadastrados para sua conta.</p></div>}</div></section></main>;
}
