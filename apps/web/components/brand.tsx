import Image from "next/image";

export function Brand({ tone = "dark", className = "", href = "/dashboard" }: { tone?: "dark" | "light"; className?: string; href?: string }) {
  return <a href={href} className={`brand brand-${tone} ${className}`} aria-label="Educonnect — início">
    <Image className="brand-logo-image" src="/images/logo-educonnect.png" alt="" width={44} height={44} priority />
    <span>Educonnect</span>
  </a>;
}
