/**
 * 3D 视图（public/floorplan-3d.html）的对外契约。
 * 修改 viewer 下的静态资源后递增 VIEWER_VERSION，即可同时刷新所有引用处的缓存。
 */
export const VIEWER_VERSION = "prices-density-2";

/** 由已编码的 plan hash 生成 iframe 入口地址。 */
export function viewerSrc(hash: string): string {
  return `/floorplan-3d.html?v=${VIEWER_VERSION}#plan=${hash}`;
}
