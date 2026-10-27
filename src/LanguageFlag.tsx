import type { Language } from './types';

export function LanguageFlag({ code }: { code: Language }) {
  return <span className="language-flag" data-language-code={code} aria-hidden="true">
    <svg viewBox="0 0 60 40" focusable="false" style={{ width: 28, height: 20, display: 'block', borderRadius: 3 }}>
      {code === 'cs' && <><path fill="#fff" d="M0 0h60v20H0z"/><path fill="#d7141a" d="M0 20h60v20H0z"/><path fill="#11457e" d="M0 0l30 20L0 40z"/></>}
      {code === 'en' && <><path fill="#012169" d="M0 0h60v40H0z"/><path stroke="#fff" strokeWidth="8" d="m0 0 60 40M0 40 60 0"/><path stroke="#c8102e" strokeWidth="3" d="m0 0 60 40M0 40 60 0"/><path fill="#fff" d="M24 0h12v40H24zM0 14h60v12H0z"/><path fill="#c8102e" d="M27 0h6v40h-6zM0 17h60v6H0z"/></>}
      {code === 'ua' && <><path fill="#0057b7" d="M0 0h60v20H0z"/><path fill="#ffd700" d="M0 20h60v20H0z"/></>}
      {code === 'fr' && <><path fill="#002654" d="M0 0h20v40H0z"/><path fill="#fff" d="M20 0h20v40H20z"/><path fill="#ed2939" d="M40 0h20v40H40z"/></>}
      {code === 'de' && <><path fill="#000" d="M0 0h60v14H0z"/><path fill="#d00" d="M0 13.33h60v13.34H0z"/><path fill="#ffce00" d="M0 26.67h60V40H0z"/></>}
      {code === 'es' && <><path fill="#aa151b" d="M0 0h60v40H0z"/><path fill="#f1bf00" d="M0 10h60v20H0z"/><path fill="#aa151b" d="M15 16h7v10h-7z"/><path fill="#fff" d="M17 16h3v10h-3z"/><path fill="#aa151b" d="M14 13h9v3h-9z"/></>}
    </svg>
  </span>;
}
