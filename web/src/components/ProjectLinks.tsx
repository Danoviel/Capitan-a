import { useState } from 'react';
import { BACKEND_KINDS, type ProjectConfig } from '@puertosview/shared';

interface Props {
  config: ProjectConfig;
  /** Si hay algo escuchando en el puerto. Apagado, los enlaces solo se muestran. */
  reachable: boolean;
}

/** URL base del proyecto: la configurada o `localhost:puerto`. */
export function baseUrl(config: ProjectConfig): string | null {
  if (config.url) return config.url;
  return config.port !== null ? `http://localhost:${config.port}` : null;
}

/**
 * La dirección local del proyecto a la vista, más sus accesos directos
 * (admin, health...). Un backend no suele tener nada en `/`, así que sin estos
 * enlaces "Abrir" terminaba en un 404 de Django.
 */
export function ProjectLinks({ config, reachable }: Props) {
  const [copied, setCopied] = useState(false);
  const base = baseUrl(config);
  if (!base) return null;

  // Un backend no tiene página en `/` (Django responde 404): su dirección se muestra, no se abre.
  const isBackend = BACKEND_KINDS.includes(config.kind) && !config.url;
  const extra = (config.links ?? []).map((link) => ({
    label: link.label,
    href: new URL(link.path, base).href,
    mono: false,
  }));
  const main = { label: base.replace(/^https?:\/\//, ''), href: base, mono: true };
  const links = isBackend ? extra : [main, ...extra];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(base);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* sin permiso de portapapeles: el enlace sigue a la vista */
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
      {isBackend && (
        <span
          title="La raíz de un backend no tiene página: usa los enlaces o cópiala para el .env del FE"
          className="rounded-md px-2 py-0.5 font-mono text-slate-400 ring-1 ring-slate-800"
        >
          {main.label}
        </span>
      )}
      {links.map((link) =>
        reachable ? (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            title={link.href}
            className={`rounded-md bg-sky-500/10 px-2 py-0.5 text-sky-200 ring-1 ring-sky-500/20 transition-colors hover:bg-sky-500/20 ${link.mono ? 'font-mono' : ''}`}
          >
            {link.label} ↗
          </a>
        ) : (
          <span
            key={link.href}
            title="Enciéndelo para abrirlo"
            className={`rounded-md px-2 py-0.5 text-slate-600 ring-1 ring-slate-800 ${link.mono ? 'font-mono' : ''}`}
          >
            {link.label}
          </span>
        ),
      )}
      <button
        type="button"
        onClick={() => void copy()}
        title={`Copiar ${base}`}
        className="rounded-md px-1.5 py-0.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
      >
        {copied ? 'copiado ✓' : 'copiar'}
      </button>
    </div>
  );
}
