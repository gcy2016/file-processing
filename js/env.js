// 设备判断与文件大小建议上限（PRD 6：手机 200 MB、电脑 500 MB，实测后再调整）
import { MB } from "./util.js";

export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isMobile = isIOS || /Android|Mobile/i.test(navigator.userAgent);

export const SIZE_LIMIT = isMobile ? 200 * MB : 500 * MB;
// 压缩包解压后总大小与文件数上限
export const UNPACK_LIMIT = isMobile ? 600 * MB : 2000 * MB;
export const UNPACK_MAX_FILES = 10000;
// 解压后体积超过原包这么多倍，按疑似解压炸弹拒绝
export const BOMB_RATIO = 100;
