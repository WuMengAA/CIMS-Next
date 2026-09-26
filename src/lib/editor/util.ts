import type { CardModel, CardType } from "./types";
import { getCardType } from "./card-types";

/** 生成卡片唯一 id（浏览器/Node 都安全）。 */
export function newId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return "c_" + Math.random().toString(36).slice(2, 10);
}

/**
 * 按类型新建一张卡片，套用注册表里的默认尺寸/属性/样式。
 * 调用方负责给定最终坐标与层级（z）。
 */
export function createCard(
	type: CardType,
	pos: { x: number; y: number } = { x: 40, y: 40 },
	z = 1
): CardModel {
	const def = getCardType(type);
	return {
		id: newId(),
		type,
		x: pos.x,
		y: pos.y,
		w: def.defaultSize.w,
		h: def.defaultSize.h,
		z,
		props: structuredClone(def.defaultProps),
		style: structuredClone(def.defaultStyle)
	};
}
