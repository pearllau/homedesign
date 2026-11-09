// A code-native architectural illustration; no external image or rendering dependency.
export function RoomScene({ compact = false }: { compact?: boolean }) {
  return (
    <svg className={compact ? "room-scene compact" : "room-scene"} viewBox="0 0 580 420" fill="none" aria-hidden="true">
      <path d="m56 282 234 135 238-138" stroke="#d6d1c8" strokeDasharray="3 6" />
      <path d="m90 260 210 121 213-124-213-123Z" fill="#ded6c8" />
      <path d="m90 249 210 121 213-124-213-123Z" fill="#eae4d9" />
      <path d="m90 249 210 121v11L90 260Z" fill="#c5baaa" />
      <path d="m300 370 213-124v11L300 381Z" fill="#d1c8b8" />
      <g stroke="#d7cdbd" strokeWidth="1">
        <path d="m119 232 210 121m-180-139 210 121m-180-139 210 121m-180-139 210 121m-180-139 210 121m-180-139 210 121" />
      </g>
      <path d="M90 249 300 123V25L90 150Z" fill="#e4e1d8" />
      <path d="m300 123 213 123V148L300 25Z" fill="#f4f1e9" />
      <path d="M90 249V150L300 25l213 123v98" stroke="#c7c0b3" strokeWidth="2" />
      <path d="m96 245 204-120 207 120" stroke="#c6bba9" strokeWidth="4" />
      <path d="m352 78 114 65v76l-114-65Z" fill="#c4c8bf" stroke="#b4b6ac" strokeWidth="6" />
      <path d="m358 84 102 59v66l-102-59Z" fill="#e3e9e3" />
      <path d="M408 113v64m-50-63 102 59" stroke="#c0c7be" strokeWidth="3" />
      <path d="m352 157 114 66 6-4-115-66Z" fill="#d0c8ba" />
      <path d="m165 275 139-81 134 78-139 81Z" fill="#d3c7b2" />
      <path d="m177 275 127-73 122 70-127 73Z" stroke="#e4dbcc" />
      <g className="scene-sofa">
        <path d="m123 205 119-70v-29l-119 70Z" fill="#a0ad96" />
        <path d="m123 205 119-70 56 33-121 71Z" fill="#c7d0bc" />
        <path d="m177 239 121-71v27l-121 71Z" fill="#aab69d" />
        <path d="m123 205 54 34v27l-54-33Z" fill="#96a48c" />
        <path d="m130 182 110-64v22l-110 65Z" fill="#b9c6ab" />
        <path d="m142 207 45-26 41 24-45 27Z" fill="#d4dcc9" />
        <path d="m191 178 45-26 41 23-45 27Z" fill="#d4dcc9" />
        <path d="m123 205 14-8 54 32-14 10Zm119-70 14-8 55 32-13 9Z" fill="#b5c2a7" />
        <path d="m123 176 14-8v29l-14 8Zm175-17 13-8v35l-13 9Z" fill="#9cae90" />
        <path d="m147 245 0 11m130-55v11" stroke="#8a7e6b" strokeWidth="4" />
        <path d="m157 181 15-9 14 8v20l-16 9-13-8Z" fill="#e5dece" />
      </g>
      <g>
        <path d="M270 274v22m63-33v22" stroke="#b39a7b" strokeWidth="5" />
        <path d="m252 263 57-33 52 30-57 34-52-30Z" fill="#d4baa0" />
        <path d="m252 258 57-33 52 30-57 34-52-30Z" fill="#e9d3b7" />
        <path d="m280 249 16-9 22 13-16 9Z" fill="#f6f2e9" />
        <path d="m287 248 16 9" stroke="#a8967d" />
        <ellipse cx="329" cy="257" rx="8" ry="4.5" fill="#b7a18b" />
        <path d="M323 251v6c0 4 12 4 12 0v-6Z" fill="#f7f4ec" />
        <ellipse cx="329" cy="251" rx="6" ry="3" fill="#b7a18b" />
      </g>
      <g>
        <path d="m397 265 62-35 29 16-62 36Z" fill="#d8c3a3" />
        <path d="m397 265 29 17v22l-29-17Zm29 17 62-36v22l-62 36Z" fill="#c2a984" />
        <path d="m425 274 54-31" stroke="#f0e2cb" />
        <path d="m418 259 41-24v-50l-41 24Z" fill="#3c413c" />
        <path d="m422 257 33-19v-43l-33 19Z" fill="#5b6258" />
      </g>
      <g className="scene-plant">
        <ellipse cx="116" cy="270" rx="15" ry="8" fill="#d7c2aa" />
        <path d="m101 270 5 23c2 8 19 8 21 0l4-23" fill="#c5ab8c" />
        <path d="M116 270v-58m0 30-16-19m16 7 18-22" stroke="#75876d" strokeWidth="3" />
        <path d="M116 235c-23 0-26-22-26-22 22-5 27 11 26 22Zm0-14c-8-20 6-30 6-30 17 15 1 29-6 30Zm5 11c4-21 24-21 24-21-1 18-15 23-24 21Z" fill="#8c9d7d" />
      </g>
      <path d="M201 114V58" stroke="#b0a18b" strokeWidth="2" />
      <path d="m184 119 17-20 18 1 8 14-24 14Z" fill="#f6f0e4" stroke="#c6b9a3" />
      {!compact && <g stroke="#b1a796" strokeWidth="1"><path d="m97 300 179 104m-184-97 9-15m171 118 9-15M528 275l-190 110m196-105-9-14m-181 125-9-14" /></g>}
    </svg>
  );
}
