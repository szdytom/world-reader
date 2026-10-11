import type { Detection, Direction } from './types';

// COCO's 80 classes, in their model class order.
export const labels = [
  '人', '自行车', '汽车', '摩托车', '飞机', '公交车', '火车', '卡车', '船', '交通灯',
  '消防栓', '停车标志', '停车计时器', '长椅', '鸟', '猫', '狗', '马', '羊', '牛',
  '大象', '熊', '斑马', '长颈鹿', '背包', '雨伞', '手提包', '领带', '行李箱', '飞盘',
  '滑雪板', '单板滑雪板', '球', '风筝', '棒球棒', '棒球手套', '滑板', '冲浪板', '网球拍', '瓶子',
  '酒杯', '杯子', '叉子', '刀', '勺子', '碗', '香蕉', '苹果', '三明治', '橙子',
  '西兰花', '胡萝卜', '热狗', '披萨', '甜甜圈', '蛋糕', '椅子', '沙发', '盆栽', '床',
  '餐桌', '马桶', '电视', '笔记本电脑', '鼠标', '遥控器', '键盘', '手机', '微波炉', '烤箱',
  '烤面包机', '水槽', '冰箱', '书', '时钟', '花瓶', '剪刀', '泰迪熊', '吹风机', '牙刷',
];
export function directionFor(center: number): Direction {
  return center < 1 / 3 ? '左侧' : center > 2 / 3 ? '右侧' : '中间';
}
export function describeScene(detections: Detection[]): string {
  if (!detections.length) return '暂时没有识别到熟悉的物体，请缓慢移动镜头。';
  const groups = new Map<string, number>();
  for (const d of detections) {
    const key = `${d.direction}有${d.label}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return '画面中，' + Array.from(groups, ([key, count]) => count > 1 ? `${key}，共${count}个` : key).slice(0, 8).join('；') + '。';
}
export function sceneSignature(detections: Detection[]): string {
  return detections.map(d => `${d.name}:${d.direction}`).sort().join('|');
}
