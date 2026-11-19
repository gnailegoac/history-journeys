// 读摆件、点缀的参数：照 src/domain/sceneKinds.ts 里的两张表读，程序在 src/domain/sceneParams.ts
// （算地面的一边也从那里读，两边才对得上）。零件库里的零件都从这里取，不用各自去找。

export { dressingParams, thingParams } from '../../../domain/sceneParams';
export type { DressingParams, ThingParams } from '../../../domain/sceneParams';
