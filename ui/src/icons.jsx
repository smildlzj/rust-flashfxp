import React from 'react'

/** 经典 16×16 矢量图标 */
export default function SvgIcon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      {name === 'connect' && (
        <path d="M9 1 L4 8 L7 8 L6 15 L12 6 L9 6 Z" fill="#e6a000" stroke="#7a5500" strokeWidth="0.6" />
      )}
      {name === 'disconnect' && (
        <>
          <rect x="2" y="2" width="12" height="12" fill="#c80000" />
          <path d="M5 5 L11 11 M11 5 L5 11" stroke="#fff" strokeWidth="1.8" />
        </>
      )}
      {name === 'refresh' && (
        <>
          <circle cx="8" cy="8" r="5" stroke="#008200" strokeWidth="1.8" fill="none" strokeDasharray="24 8" />
          <path d="M12 3 L12 7 L8 6 Z" fill="#008200" />
        </>
      )}
      {name === 'up' && <path d="M8 2 L13 8 L10 8 L10 13 L6 13 L6 8 L3 8 Z" fill="#0046c8" />}
      {name === 'newdir' && (
        <>
          <path d="M1 4 h4 l1 1 h9 v8 H1 Z" fill="#e6a000" stroke="#7a5500" strokeWidth="0.6" />
          <path d="M1 4 v-1 h5 l1 1" fill="#e6a000" stroke="#7a5500" strokeWidth="0.6" />
        </>
      )}
      {name === 'rename' && (
        <>
          <path d="M3 13 L3 11 L11 3 L13 5 L5 13 Z" fill="#e6a000" stroke="#555" strokeWidth="0.5" />
          <path d="M3 13 L5 13 L3 11 Z" fill="#0046c8" />
        </>
      )}
      {name === 'delete' && <path d="M3 3 L13 13 M13 3 L3 13" stroke="#c80000" strokeWidth="2.2" />}
      {name === 'upload' && (
        <>
          <path d="M8 2 L12 6 L9 6 L9 10 L7 10 L7 6 L4 6 Z" fill="#0046c8" />
          <path d="M2 12 h12" stroke="#555" strokeWidth="1.6" />
        </>
      )}
      {name === 'download' && (
        <>
          <path d="M8 13 L12 9 L9 9 L9 5 L7 5 L7 9 L4 9 Z" fill="#008200" />
          <path d="M2 3 h12" stroke="#555" strokeWidth="1.6" />
        </>
      )}
      {name === 'compare' && (
        <>
          <rect x="1" y="2" width="8" height="11" fill="#4c84d933" stroke="#0046c8" strokeWidth="0.8" />
          <rect x="6" y="4" width="9" height="10" fill="#66c03333" stroke="#008200" strokeWidth="0.8" />
        </>
      )}
      {name === 'relay' && (
        <>
          <path d="M2 5 H12 L10 3 M10 7 L12 5" stroke="#b07000" strokeWidth="1.6" fill="none" />
          <path d="M14 10 H4 L6 8 M6 12 L4 10" stroke="#b07000" strokeWidth="1.6" fill="none" />
        </>
      )}
      {name === 'queue' && <path d="M2 4 H14 M2 8 H14 M2 12 H9" stroke="#1a1a6e" strokeWidth="1.6" />}
      {name === 'home' && (
        <>
          <path d="M8 2 L14 7 H12 V13 H4 V7 H2 Z" fill="#e6a000" stroke="#7a5500" strokeWidth="0.6" />
          <rect x="7" y="9" width="2" height="4" fill="#7a5500" />
        </>
      )}
    </svg>
  )
}
