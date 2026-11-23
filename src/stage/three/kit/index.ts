// 零件库的入口：按场景数据造出一座沙盘上的全部小模型。约定见 ../internal.ts。
// 沙盘程序别的部分只用这里的 buildModels 和它返回的 ModelSet，不直接碰零件库里面的文件；
// 只有一样例外：按家分块的零件（./families.ts）怎么登记、怎么取，view.ts 和 engine.ts 直接从那个文件拿。
//
// 里面分这几块：
//   geo.ts、textures.ts、parts.ts、shapes.ts  从样张搬来的零件：批次、屋顶、棱柱；贴图；殿、楼、亭、民房；石头、船、树的形状
//   materials.ts   材质（颜色只从样式里取，贴图只在这里做）
//   figure.ts      模型跟着镜头远近怎么变：只算数的那一部分（镜头那一边也用它）
//   figureMaterial.ts  同一件事在显卡上的那一部分：补进材质的一小段着色器，和它用的那一份数
//   params.ts      照 src/domain/sceneKinds.ts 的两张表读参数
//   site.ts        城墙那一圈线上的算术，各个零件之间要互相知道的事
//   pass.ts        造的时候零件手里拿到的东西：往哪一组放、脚在哪、跟着哪一组放大、谁先去掉
//   things.ts      九种摆件各怎么造；dressing.ts 七种点缀各怎么造；trees.ts 树
//   assemble.ts    总装：分组，只造一套，按小节换着显，每一帧把远近和水位交给显卡

export { buildModels } from './assemble';
