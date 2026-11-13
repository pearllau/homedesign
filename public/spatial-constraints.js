/* Deterministic circulation and keep-out helpers for recognized floor plans.
 * Coordinates are millimetres in the same world space as floorplan-3d.html.
 * This module deliberately reports infeasible layouts instead of moving walls
 * or inventing rooms. Load as a classic script before the 2D editor script.
 */
(function (root) {
  'use strict';

  const EPS = 1e-7;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const length = a => Math.hypot(a[0], a[1]);

  function inside(p, poly) {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i], ab = sub(b, a), ap = sub(p, a);
      if (Math.abs(cross(ab, ap)) < .01 && dot(ap, sub(p, b)) <= .01) return true;
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
  }

  function edgeDistance(p, poly) {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], d = sub(poly[(i + 1) % poly.length], a), n = dot(d, d) || 1;
      const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / n));
      best = Math.min(best, length(sub(p, add(a, mul(d, t)))));
    }
    return best;
  }

  function interiorPoint(poly) {
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const candidates = [[(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], poly.reduce((s, p) => add(s, p), [0, 0]).map(v => v / poly.length)];
    for (let row = 1; row < 20; row++) for (let col = 1; col < 20; col++) candidates.push([box[0] + (box[2] - box[0]) * col / 20, box[1] + (box[3] - box[1]) * row / 20]);
    let best = null, clearance = -1;
    for (const p of candidates) if (inside(p, poly)) {
      const d = edgeDistance(p, poly);
      if (d > clearance) { best = p; clearance = d; }
    }
    return best;
  }

  function openingBasis(opening, room) {
    const a = opening.p0 || opening.segment?.[0], b = opening.p1 || opening.segment?.[1];
    if (!a || !b) return null;
    const d = sub(b, a), len = length(d);
    if (len < 1) return null;
    const tangent = mul(d, 1 / len), normal = [-tangent[1], tangent[0]], mid = mul(add(a, b), .5), center = room.at || interiorPoint(room.poly);
    if (!center) return null;
    const probe = Math.max(150, (Number(opening.thickness)||0)/2+20);
    const positive = inside(add(mid,mul(normal,probe)),room.poly), negative = inside(add(mid,mul(normal,-probe)),room.poly);
    const inward = positive!==negative ? (positive?normal:mul(normal,-1)) : cross(d, sub(center, a)) >= 0 ? normal : mul(normal, -1);
    return { a, b, mid, tangent, inward, len };
  }

  function approachZone(opening, room, depth, sidePad, wallFaceOffset) {
    const basis = openingBasis(opening, room);
    if (!basis) return null;
    const { a, b, tangent, inward } = basis, pad = sidePad || 200, face = Math.max(0, Number(wallFaceOffset) || 0);
    // The requested clearance starts at the inner wall face. Openings are
    // represented by their centreline, so include half the wall thickness.
    return [add(add(a, mul(tangent, -pad)), mul(inward, face)), add(add(b, mul(tangent, pad)), mul(inward, face)), add(add(b, mul(tangent, pad)), mul(inward, face + depth)), add(add(a, mul(tangent, -pad)), mul(inward, face + depth))];
  }

  function openingRooms(opening, rooms) {
    const matches = [];
    for (const room of rooms) {
      const basis = openingBasis(opening, room);
      if (!basis) continue;
      const sample = add(basis.mid, mul(basis.inward, 150));
      if (inside(sample, room.poly)) matches.push({ room, basis });
    }
    return matches;
  }

  function pathInRoom(room, start, end, width, walls) {
    const poly = room.poly, xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
    const step = Math.max(160, Math.ceil(Math.max(x1 - x0, y1 - y0) / 90 / 10) * 10), clearance = width / 2;
    const axisPoints = (min, max) => {
      const values = [(min + max) / 2];
      if (max - min >= width) values.push(min + clearance, max - clearance);
      for (let value = min; value <= max; value += step) values.push(value);
      return [...new Set(values)].sort((a, b) => a - b);
    };
    const xPoints = axisPoints(x0, x1), yPoints = axisPoints(y0, y1), nx = xPoints.length, ny = yPoints.length;
    if (nx * ny > 18000) return null;
    const point = (ix, iy) => [xPoints[ix], yPoints[iy]];
    const valid = (ix, iy) => {
      const p = point(ix, iy);
      if (!inside(p, poly) || edgeDistance(p, poly) < clearance - .01) return false;
      return !(walls || []).some(wall => {
        const obstacle = wall.poly;
        if (!Array.isArray(obstacle) || obstacle.length < 3) return false;
        return inside(p, obstacle) || edgeDistance(p, obstacle) < clearance - .01;
      });
    };
    const nearest = target => {
      const nearestAxis = (values, value) => values.reduce((best, candidate, index) => Math.abs(candidate - value) < Math.abs(values[best] - value) ? index : best, 0);
      const tx = nearestAxis(xPoints, target[0]), ty = nearestAxis(yPoints, target[1]);
      for (let radius = 0; radius < Math.max(nx, ny); radius++) for (let iy = Math.max(0, ty - radius); iy <= Math.min(ny - 1, ty + radius); iy++) for (let ix = Math.max(0, tx - radius); ix <= Math.min(nx - 1, tx + radius); ix++) {
        if (Math.max(Math.abs(ix - tx), Math.abs(iy - ty)) !== radius || !valid(ix, iy)) continue;
        return [ix, iy];
      }
      return null;
    };
    const from = nearest(start), to = nearest(end);
    if (!from || !to) return null;
    const key = p => `${p[0]},${p[1]}`, queue = [from], previous = new Map([[key(from), null]]), dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    let found = false;
    for (let head = 0; head < queue.length && queue.length <= nx * ny; head++) {
      const cur = queue[head];
      if (cur[0] === to[0] && cur[1] === to[1]) { found = true; break; }
      for (const d of dirs) {
        const next = [cur[0] + d[0], cur[1] + d[1]], k = key(next);
        if (next[0] < 0 || next[1] < 0 || next[0] >= nx || next[1] >= ny || previous.has(k) || !valid(next[0], next[1])) continue;
        if (Math.abs(d[0]) + Math.abs(d[1]) === 2 && (!valid(cur[0] + d[0], cur[1]) || !valid(cur[0], cur[1] + d[1]))) continue;
        previous.set(k, key(cur)); queue.push(next);
      }
    }
    if (!found) return null;
    const route = [];
    for (let k = key(to); k; k = previous.get(k)) route.push(point(...k.split(',').map(Number)));
    route.reverse();
    const simplified = [];
    for (let i = 0; i < route.length; i++) {
      if (i > 0 && i < route.length - 1) {
        const a = sub(route[i], route[i - 1]), b = sub(route[i + 1], route[i]);
        if (Math.abs(cross(a, b)) < .01 && dot(a, b) > 0) continue;
      }
      simplified.push(route[i]);
    }
    return simplified;
  }

  function routeZones(points, width, roomId) {
    const zones = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i], b = points[i + 1], d = sub(b, a), len = length(d);
      if (len < 1) continue;
      const n = [-d[1] / len * width / 2, d[0] / len * width / 2];
      zones.push({ type: 'route', roomId, width, polygon: [add(a, n), add(b, n), sub(b, n), sub(a, n)] });
    }
    return zones;
  }

  function prepare(input) {
    const rooms = (input?.rooms || []).filter(room => Array.isArray(room.poly) && room.poly.length >= 3), walls = input?.walls || [];
    const openings = input?.openings || [], zones = [], warnings = [], routes = [], portals = [], edges = [];
    for (const opening of openings) {
      const kind = opening.kind;
      if (kind !== 'door' && kind !== 'passage' && kind !== 'window') continue;
      const adjacent = openingRooms(opening, rooms);
      for (const { room } of adjacent) {
        const depth = kind === 'window' ? 800 : 1000;
        const wallFace = Math.max(0, Number(opening.thickness) || 0) / 2;
        const polygon = approachZone(opening, room, depth, kind === 'window' ? 250 : 200, wallFace);
        if (polygon && !opening.virtual) zones.push({ type: kind === 'window' ? 'window-clearance' : 'door-clearance', openingId: opening.id || '', roomId: room.id, depth, polygon });
        if (kind !== 'window') portals.push({ openingId: opening.id || '', roomId: room.id, center: openingBasis(opening, room)?.mid, entry: opening.entry === true });
      }
      for (let i = 0; i < adjacent.length; i++) for (let j = i + 1; j < adjacent.length; j++) edges.push({ from: adjacent[i].room.id, to: adjacent[j].room.id, openingId: opening.id || '' });
    }

    for (const room of rooms) {
      const roomDoors = portals.filter(portal => portal.roomId === room.id);
      if (!roomDoors.length) continue;
      const name = String(room.name || ''), width = /走廊|过道|走道|通道|玄关|客厅|起居|餐厅|公共/.test(name) ? 1000 : 800;
      const hub = interiorPoint(room.poly);
      if (!hub) { warnings.push(`${name || '房间'}没有可计算的内部点，无法建立通行动线。`); continue; }
      const targets = roomDoors.length > 1 ? roomDoors.map(portal => portal.center) : [hub];
      const origin = roomDoors[0];
      for (let i = 0; i < targets.length; i++) {
        const portal = i === 0 && roomDoors.length > 1 ? roomDoors[roomDoors.length - 1] : origin;
        const basis = openingBasis(openings.find(item => item.id === portal.openingId) || {}, room);
        const start = basis ? add(basis.mid, mul(basis.inward, width * .65)) : portal.center;
        const route = pathInRoom(room, start, targets[i], width, walls);
        if (!route) { warnings.push(`${name || '房间'}的入口无法保留 ${width} mm 连续通道；请缩小或重新摆放家具。`); continue; }
        routes.push({ roomId: room.id, width, points: route });
        zones.push(...routeZones(route, width, room.id));
      }
    }
    return { rooms, walls, openings, zones, warnings: [...new Set(warnings)], routes, graph: { portals, edges } };
  }

  function boxPolygon(item) {
    if (Array.isArray(item.polygon)) return item.polygon;
    if (item.cx == null || item.cy == null || item.w == null || item.d == null) return null;
    const angle = (Number(item.rot) || 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle), hw = Number(item.w) / 2, hd = Number(item.d) / 2;
    return [[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]].map(([x,y]) => [item.cx + x*c - y*s, item.cy + x*s + y*c]);
  }

  function overlaps(a, b) {
    const project = (poly, axis) => poly.map(p => p[0] * axis[0] + p[1] * axis[1]);
    for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
      const d = sub(poly[(i + 1) % poly.length], poly[i]), axis = [-d[1], d[0]], x = project(a, axis), y = project(b, axis);
      if (Math.max(...x) <= Math.min(...y) + EPS || Math.max(...y) <= Math.min(...x) + EPS) return false;
    }
    return true;
  }

  function audit(scene, furniture) {
    const layout = scene?.zones ? scene : prepare(scene || {}), warnings = [...layout.warnings];
    const items = (furniture || []).filter(item => boxPolygon(item));
    for (let index = 0; index < items.length; index++) {
      const item = items[index], poly = boxPolygon(item);
      const containingRoom = (layout.rooms || []).find(room => inside([item.cx, item.cy], room.poly));
      if (layout.rooms?.length && (!containingRoom || poly.some(point => !inside(point, containingRoom.poly)))) {
        warnings.push(`${item.name || '家具'}超出所在房间边界。`);
      }
      for (let otherIndex = index + 1; otherIndex < items.length; otherIndex++) {
        if (overlaps(poly, boxPolygon(items[otherIndex]))) warnings.push(`${item.name || '家具'}与${items[otherIndex].name || '其他家具'}发生碰撞。`);
      }
      if (!poly) continue;
      for (const wall of layout.walls || []) if (Array.isArray(wall.poly) && overlaps(poly, wall.poly)) {
        warnings.push(`${item.name || '家具'}与实墙重叠。`);
        break;
      }
      for (const zone of layout.zones) if (overlaps(poly, zone.polygon)) {
        const label = zone.type === 'window-clearance' ? '窗前 800 mm 采光区' : zone.type === 'door-clearance' ? '门前通行区' : `${zone.width} mm 动线`;
        warnings.push(`${item.name || '家具'}占用了${label}，请移动或缩小。`);
        break;
      }
    }

    // A dining table needs room for a chair to pull out and for someone to
    // pass behind it. Chairs themselves belong inside that 600 mm envelope.
    const tables = items.filter(item => item.type === 'table' || item.type === 'roundtable' || /餐桌/.test(String(item.name || '')));
    for (const table of tables) {
      const envelope = boxPolygon({ ...table, w: Number(table.w) + 1200, d: Number(table.d) + 1200 });
      for (const item of items) {
        if (item === table || /椅|凳|chair|stool/i.test(`${item.type || ''} ${item.name || ''}`)) continue;
        if (overlaps(envelope, boxPolygon(item))) warnings.push(`${item.name || '家具'}侵占餐桌周围 600 mm 拉椅与通行空间。`);
      }
    }

    // These categories have a tall cabinet body, headboard or sofa back and
    // should use a real solid-wall anchor. Keep this as a visible audit so a
    // hand-edited item is checked by the same rule as an automatic placement.
    const anchoredTypes = new Set(['bed', 'wardrobe', 'fridge', 'bookshelf', 'ovencol', 'shoecab', 'sofa', 'cornersofa']);
    for (const item of items) {
      const type = String(item.type || '').toLowerCase(), name = String(item.name || '');
      const needsWall = Number(item.height) > 1200 || anchoredTypes.has(type) || /衣柜|冰箱|高柜|书架|鞋柜|床|沙发/.test(name);
      if (!needsWall || !Array.isArray(layout.walls) || !layout.walls.length) continue;
      const poly = boxPolygon(item);
      let snapped = false;
      for (let i = 0; i < poly.length && !snapped; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], edge = sub(b, a), edgeLength = length(edge);
        if (edgeLength < 1) continue;
        for (const wall of layout.walls) {
          const segment = wall.segment;
          if (!Array.isArray(segment) || segment.length !== 2) continue;
          const wallEdge = sub(segment[1], segment[0]), wallLength = length(wallEdge);
          if (wallLength < 1 || Math.abs(cross(edge, wallEdge) / (edgeLength * wallLength)) > .035) continue;
          const normal = [-edge[1] / edgeLength, edge[0] / edgeLength];
          const separation = Math.abs(dot(sub(segment[0], a), normal));
          const expected = Math.max(0, Number(wall.thickness) || 0) / 2;
          const project = point => dot(sub(point, a), mul(edge, 1 / edgeLength));
          const start = project(segment[0]), end = project(segment[1]);
          if (Math.min(Math.max(start, end), edgeLength) - Math.max(Math.min(start, end), 0) > Math.min(300, edgeLength * .25) && Math.abs(separation - expected) <= 100) { snapped = true; break; }
        }
      }
      if (!snapped) warnings.push(`${item.name || '高大家具'}未贴靠可用实墙，请调整朝向或位置。`);
    }
    return [...new Set(warnings)];
  }

  root.SpaceConstraints = { prepare, audit, pointInPolygon: inside, polygonsOverlap: overlaps };
})(typeof window !== 'undefined' ? window : globalThis);
