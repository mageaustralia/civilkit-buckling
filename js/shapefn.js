/* Longitudinal shape functions, CUFSM analysis/Ym_at_ys.m (B.W. Schafer, 2015). */
export function Ym(bc, m, y, a) {
  const s = Math.sin, c = Math.cos, pi = Math.PI;
  switch (bc) {
    case 'S-S': return s(m * pi * y / a);
    case 'C-C': return s(m * pi * y / a) * s(pi * y / a);
    case 'S-C': case 'C-S': return s((m + 1) * pi * y / a) + (m + 1) / m * s(m * pi * y / a);
    case 'C-F': case 'F-C': return 1 - c((m - 0.5) * pi * y / a);
    case 'C-G': case 'G-C': return s((m - 0.5) * pi * y / a) * s(pi * y / a / 2);
    default: throw new Error(`unknown boundary condition ${bc}`);
  }
}
