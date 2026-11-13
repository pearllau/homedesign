// Original vector animation: a floor plan is drawn while a real request is pending.
// The completion mark is a separate, non-looping composition.
const green = [0.204, 0.396, 0.22, 1];

function line(name: string, points: number[][], delay: number, complete: boolean) {
  return {
    ty: "gr", nm: name,
    it: [
      { ty: "sh", ks: { a: 0, k: { i: points.map(() => [0, 0]), o: points.map(() => [0, 0]), v: points, c: false } } },
      { ty: "st", c: { a: 0, k: green }, o: { a: 0, k: 100 }, w: { a: 0, k: 2.8 }, lc: 2, lj: 2 },
      { ty: "tm", s: { a: 0, k: 0 }, e: { a: 1, k: [
        { t: delay, s: [0], e: [100], i: { x: [0.7], y: [1] }, o: { x: [0.2], y: [0] } },
        { t: delay + (complete ? 20 : 30), s: [100] },
      ] }, o: { a: 0, k: 0 }, m: 1 },
      { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
    ],
  };
}

export function makePlanAnimation(complete: boolean) {
  const end = complete ? 42 : 100;
  return {
    v: "5.13.0", fr: 30, ip: 0, op: end, w: 80, h: 80, nm: complete ? "Plan ready" : "Drawing a home", ddd: 0, assets: [],
    layers: [{
      ddd: 0, ind: 1, ty: 4, nm: "Home", sr: 1,
      ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
      shapes: complete ? [line("Check", [[20, 42], [34, 56], [61, 25]], 0, true)] : [
        line("Walls", [[17, 63], [17, 17], [63, 17], [63, 63], [44, 63]], 0, false),
        line("Rooms", [[17, 38], [41, 38], [41, 17]], 12, false),
        line("Door", [[41, 63], [41, 47], [55, 47]], 27, false),
        line("Window", [[27, 24], [34, 24]], 38, false),
      ], ip: 0, op: end, st: 0, bm: 0,
    }],
  };
}
