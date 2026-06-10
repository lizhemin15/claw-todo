/**
 * Workout Exercise SVG Generator v2
 * Shows KEY ACTION pose with ghost/trajectory lines for movement
 * Clean minimalist style: #333 body, #4A90D9 active parts, #E74C3C arrows, #ddd ghost
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = '/root/claw-todo/server/static/img/workout';

function svg(w, h, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" fill="none" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
}

// Drawing primitives
const draw = {
  circle: (cx, cy, r, stroke='#333', sw=2.5) => `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="${stroke}" stroke-width="${sw}" fill="none"/>`,
  line: (x1,y1,x2,y2, stroke='#333', sw=2.5) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"/>`,
  ghostLine: (x1,y1,x2,y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ccc" stroke-width="1.5" stroke-dasharray="4,3"/>`,
  ghostCircle: (cx,cy,r) => `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="#ccc" stroke-width="1.5" stroke-dasharray="4,3" fill="none"/>`,
  arrow: (x1,y1,x2,y2) => {
    const id = `a${Math.random().toString(36).slice(2,6)}`;
    return `<defs><marker id="${id}" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><path d="M0,0 L7,2.5 L0,5Z" fill="#E74C3C"/></marker></defs><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#E74C3C" stroke-width="2" marker-end="url(#${id})"/>`;
  },
  band: (d) => `<path d="${d}" stroke="#E67E22" stroke-width="2.5" fill="none"/>`,
  floor: (y, w=300) => `<line x1="20" y1="${y}" x2="${w-20}" y2="${y}" stroke="#ddd" stroke-width="1"/>`,
  dot: (x,y,c='#999') => `<circle cx="${x}" cy="${y}" r="3" fill="${c}"/>`,
};

const BLUE = '#4A90D9';
const RED = '#E74C3C';
const GRAY = '#333';

const exercises = {
  '死虫式': () => {
    // 仰卧，对侧手脚缓慢下放后还原
    // Show: one arm+leg lowered (active), other up (start) with ghost
    let s = draw.floor(310, 300);
    // Body on ground
    s += draw.line(80,170, 220,170, GRAY); // torso horizontal
    s += draw.circle(70,170, 16, GRAY); // head
    // Left arm up (start position)
    s += draw.line(95,165, 95,100, BLUE);
    // Left leg up (start)
    s += draw.line(130,170, 110,110, BLUE);
    s += draw.line(110,110, 110,80, BLUE);
    // Right arm lowered (active) - ghost shows where it was
    s += draw.ghostLine(175,165, 175,100);
    s += draw.line(175,170, 230,210, BLUE);
    // Right leg lowered (active)
    s += draw.ghostLine(190,170, 200,110);
    s += draw.ghostLine(200,110, 200,80);
    s += draw.line(190,170, 210,240, BLUE);
    s += draw.line(210,240, 240,280, BLUE);
    // Arrows
    s += draw.arrow(230,210, 245,230);
    s += draw.arrow(240,280, 255,300);
    return svg(300, 340, s);
  },

  '俯卧撑': () => {
    // 双手撑地，身体保持一条直线，胸部贴近地面
    let s = draw.floor(280, 320);
    // Body at angle (down position)
    s += draw.line(60,130, 260,140, GRAY); // body line
    s += draw.circle(50,128, 16, GRAY); // head
    // Arms (bent, close to ground)
    s += draw.line(90,135, 80,200, BLUE);
    s += draw.line(80,200, 80,265, BLUE);
    s += draw.line(140,137, 130,200, BLUE);
    s += draw.line(130,200, 130,265, BLUE);
    // Legs
    s += draw.line(260,140, 280,200, GRAY);
    s += draw.line(280,200, 290,265, GRAY);
    // Arrow showing push up
    s += draw.arrow(160,135, 160,100);
    // Ghost up position
    s += draw.ghostLine(60,80, 260,85);
    s += draw.ghostCircle(50,78, 16);
    return svg(320, 310, s);
  },

  '深蹲': () => {
    // 双脚与肩同宽，臀部后坐下蹲至大腿与地面平行
    let s = draw.floor(320, 300);
    // Squat position
    s += draw.circle(150,62, 16, GRAY);
    s += draw.line(150,78, 130,160, GRAY); // torso (slight lean)
    // Arms forward
    s += draw.line(140,110, 70,110, BLUE);
    s += draw.line(140,110, 210,110, BLUE);
    // Legs bent
    s += draw.line(130,160, 90,220, BLUE);
    s += draw.line(90,220, 100,310, BLUE);
    s += draw.line(130,160, 180,220, BLUE);
    s += draw.line(180,220, 190,310, BLUE);
    // Ghost standing position
    s += draw.ghostLine(150,78, 150,220);
    s += draw.ghostLine(150,220, 120,310);
    s += draw.ghostLine(150,220, 180,310);
    // Arrow: down
    s += draw.arrow(220,160, 220,200);
    return svg(300, 340, s);
  },

  '平板支撑': () => {
    // 前臂撑地，身体保持直线
    let s = draw.floor(270, 320);
    s += draw.circle(60,140, 16, GRAY);
    s += draw.line(60,156, 270,165, GRAY);
    // Forearms
    s += draw.line(75,158, 80,220, BLUE);
    s += draw.line(80,220, 120,220, BLUE);
    s += draw.line(100,160, 110,220, BLUE);
    s += draw.line(110,220, 140,220, BLUE);
    // Legs
    s += draw.line(270,165, 285,230, GRAY);
    s += draw.line(285,230, 290,265, GRAY);
    // Hold indicator
    s += draw.arrow(180,140, 180,160); // slight pressure down
    return svg(320, 300, s);
  },

  '弓步蹲': () => {
    // 一腿前跨下蹲，后膝接近地面
    let s = draw.floor(320, 320);
    s += draw.circle(150,55, 16, GRAY);
    s += draw.line(150,71, 140,180, GRAY); // torso
    // Arms at sides
    s += draw.line(145,100, 100,100, GRAY);
    s += draw.line(145,100, 190,100, GRAY);
    // Front leg bent
    s += draw.line(140,180, 90,240, BLUE);
    s += draw.line(90,240, 90,310, BLUE);
    // Back leg
    s += draw.line(140,180, 210,250, BLUE);
    s += draw.line(210,250, 240,310, BLUE);
    // Ghost standing
    s += draw.ghostLine(150,71, 150,240);
    s += draw.ghostLine(150,240, 110,310);
    s += draw.ghostLine(150,240, 190,310);
    // Arrow down
    s += draw.arrow(160,180, 165,220);
    return svg(320, 340, s);
  },

  '登山者': () => {
    // 俯撑交替提膝至胸
    let s = draw.floor(280, 320);
    s += draw.circle(60,120, 16, GRAY);
    s += draw.line(60,136, 250,148, GRAY);
    // Arms straight
    s += draw.line(80,140, 80,270, BLUE);
    s += draw.line(160,145, 160,270, BLUE);
    // Right leg back
    s += draw.line(250,148, 275,230, GRAY);
    s += draw.line(275,230, 285,270, GRAY);
    // Left leg driving forward (knee to chest)
    s += draw.line(200,150, 140,170, BLUE);
    s += draw.line(140,170, 120,140, BLUE);
    // Ghost: leg back position
    s += draw.ghostLine(200,150, 250,200);
    s += draw.ghostLine(250,200, 260,270);
    // Arrow: knee forward
    s += draw.arrow(120,140, 95,130);
    return svg(320, 300, s);
  },

  '波比跳': () => {
    // 下蹲→俯撑→跳起 (show jump phase)
    let s = draw.floor(310, 300);
    // Jump phase
    s += draw.circle(150,50, 16, GRAY);
    s += draw.line(150,66, 150,180, GRAY);
    // Arms up
    s += draw.line(150,90, 100,40, BLUE);
    s += draw.line(150,90, 200,40, BLUE);
    // Legs (slight jump spread)
    s += draw.line(150,180, 120,290, BLUE);
    s += draw.line(150,180, 180,290, BLUE);
    // Feet off ground - gap before floor line
    s += draw.floor(310, 300);
    // Ghost: squat phase
    s += draw.ghostLine(150,66, 140,160);
    s += draw.ghostLine(140,160, 110,230);
    s += draw.ghostLine(140,160, 170,230);
    // Arrow: up
    s += draw.arrow(150,40, 150,15);
    return svg(300, 330, s);
  },

  '开合跳': () => {
    // 双脚跳开同时双臂上举
    let s = draw.floor(320, 320);
    s += draw.circle(150,55, 16, GRAY);
    s += draw.line(150,71, 150,200, GRAY);
    // Arms up (V shape)
    s += draw.line(150,90, 80,35, BLUE);
    s += draw.line(150,90, 220,35, BLUE);
    // Legs apart
    s += draw.line(150,200, 70,310, BLUE);
    s += draw.line(150,200, 230,310, BLUE);
    // Ghost: closed position
    s += draw.ghostLine(150,90, 110,120);
    s += draw.ghostLine(150,90, 190,120);
    s += draw.ghostLine(150,200, 130,310);
    s += draw.ghostLine(150,200, 170,310);
    // Arrows: outward
    s += draw.arrow(80,35, 60,20);
    s += draw.arrow(220,35, 240,20);
    s += draw.arrow(70,310, 50,320);
    s += draw.arrow(230,310, 250,320);
    return svg(320, 340, s);
  },

  '高抬腿': () => {
    // 原地交替抬膝至腰部高度
    let s = draw.floor(310, 300);
    s += draw.circle(150,55, 16, GRAY);
    s += draw.line(150,71, 150,200, GRAY);
    // Left arm back, right arm forward (pumping)
    s += draw.line(150,90, 100,120, BLUE);
    s += draw.line(150,90, 200,80, BLUE);
    // Right leg down
    s += draw.line(150,200, 175,300, GRAY);
    // Left leg high knee (active)
    s += draw.line(150,200, 120,160, BLUE);
    s += draw.line(120,160, 110,120, BLUE);
    // Ghost: other leg up
    s += draw.ghostLine(150,200, 180,160);
    s += draw.ghostLine(180,160, 190,120);
    // Arrow: up
    s += draw.arrow(110,120, 100,95);
    return svg(300, 330, s);
  },

  '臀桥': () => {
    // 仰卧屈膝，抬臀至身体一条直线
    let s = draw.floor(300, 320);
    // Body flat (ghost)
    s += draw.ghostLine(60,190, 220,190);
    s += draw.ghostCircle(50,190, 16);
    // Body raised (active)
    s += draw.circle(55,180, 16, GRAY);
    s += draw.line(55,196, 140,140, GRAY); // angled up
    s += draw.line(140,140, 220,190, GRAY); // back down
    // Arms on ground
    s += draw.line(75,195, 75,240, GRAY);
    s += draw.line(95,195, 95,240, GRAY);
    // Legs bent (feet flat)
    s += draw.line(220,190, 200,140, BLUE); // upper leg
    s += draw.line(200,140, 200,240, BLUE); // lower leg
    s += draw.line(220,190, 240,140, BLUE);
    s += draw.line(240,140, 240,240, BLUE);
    // Arrow: hip up
    s += draw.arrow(140,140, 140,110);
    return svg(300, 270, s);
  },

  '侧平板支撑': () => {
    // 侧卧单臂撑，身体一条直线
    let s = '';
    // Side-lying: body vertical
    s += draw.circle(150,55, 16, GRAY);
    s += draw.line(150,71, 150,260, GRAY);
    // Supporting arm (bottom)
    s += draw.line(150,80, 150,260, BLUE);
    // Top arm along body
    s += draw.line(150,120, 170,120, GRAY);
    // Legs stacked
    s += draw.line(150,260, 130,340, GRAY);
    s += draw.line(150,260, 170,340, GRAY);
    // Floor
    s += draw.line(20,340, 280,340, '#ddd', 1);
    // Hold arrow
    s += draw.arrow(120,170, 100,170);
    return svg(300, 360, s);
  },

  '俄罗斯转体': () => {
    // 坐姿，双脚离地，双手持物左右转体
    let s = draw.floor(310, 300);
    // Seated, leaning back slightly
    s += draw.circle(120,90, 16, GRAY);
    s += draw.line(120,106, 150,200, GRAY); // torso angled back
    // Hands together at one side (twist)
    s += draw.line(130,130, 70,150, BLUE);
    s += draw.line(130,130, 75,155, BLUE);
    // Ghost: other side
    s += draw.ghostLine(130,130, 200,150);
    s += draw.ghostLine(130,130, 195,155);
    // Legs raised
    s += draw.line(150,200, 120,280, GRAY);
    s += draw.line(120,280, 100,280, GRAY);
    s += draw.line(150,200, 190,280, GRAY);
    s += draw.line(190,280, 210,280, GRAY);
    // Arrow: twist
    s += draw.arrow(70,150, 50,160);
    return svg(300, 310, s);
  },

  '仰卧举腿': () => {
    // 仰卧，双腿伸直抬起至90度
    let s = draw.floor(290, 320);
    // Body on ground
    s += draw.circle(60,190, 16, GRAY);
    s += draw.line(60,190, 200,200, GRAY);
    // Arms by sides
    s += draw.line(80,200, 70,250, GRAY);
    s += draw.line(120,200, 110,250, GRAY);
    // Legs up at 90 degrees (active)
    s += draw.line(200,200, 210,90, BLUE);
    s += draw.line(210,90, 210,60, BLUE);
    s += draw.line(200,200, 230,90, BLUE);
    s += draw.line(230,90, 230,60, BLUE);
    // Ghost: legs on ground
    s += draw.ghostLine(200,200, 230,250);
    s += draw.ghostLine(230,250, 260,250);
    // Arrow: up
    s += draw.arrow(220,60, 220,30);
    return svg(300, 270, s);
  },

  '超人式': () => {
    // 俯卧，同时抬起对侧手脚
    let s = draw.floor(280, 320);
    // Body on ground
    s += draw.line(60,200, 240,200, GRAY);
    s += draw.circle(45,200, 16, GRAY);
    // Right arm up (active)
    s += draw.line(70,195, 30,140, BLUE);
    // Left leg up (active)
    s += draw.line(230,200, 270,140, BLUE);
    // Ghost: down position
    s += draw.ghostLine(70,195, 30,200);
    s += draw.ghostLine(230,200, 270,200);
    // Left arm & right leg on ground
    s += draw.line(80,200, 50,240, GRAY);
    s += draw.line(220,200, 240,240, GRAY);
    // Arrows
    s += draw.arrow(30,140, 20,115);
    s += draw.arrow(270,140, 280,115);
    return svg(300, 270, s);
  },

  '站立体前屈': () => {
    // 双腿伸直，弯腰手触地
    let s = draw.floor(320, 320);
    // Standing, bent forward
    s += draw.circle(110,130, 16, GRAY);
    s += draw.line(110,146, 140,260, GRAY); // torso bent over
    // Arms reaching down
    s += draw.line(115,170, 100,270, BLUE);
    s += draw.line(125,175, 120,270, BLUE);
    // Legs straight
    s += draw.line(140,260, 120,310, GRAY);
    s += draw.line(140,260, 170,310, GRAY);
    // Ghost: upright
    s += draw.ghostLine(110,146, 110,260);
    s += draw.ghostCircle(110,50, 16);
    // Arrow: down
    s += draw.arrow(105,270, 100,295);
    return svg(300, 330, s);
  },

  '鸟狗式': () => {
    // 四足跪姿，对侧手脚伸展
    let s = draw.floor(280, 320);
    s += draw.circle(70,110, 16, GRAY);
    // Torso horizontal
    s += draw.line(70,126, 220,150, GRAY);
    // Right arm forward (active)
    s += draw.line(80,128, 20,80, BLUE);
    // Left leg back (active)
    s += draw.line(200,148, 270,100, BLUE);
    // Left arm on ground
    s += draw.line(90,130, 100,200, GRAY);
    // Right leg kneeling
    s += draw.line(180,148, 190,200, GRAY);
    // Ghost: tucked position
    s += draw.ghostLine(80,128, 80,160);
    s += draw.ghostLine(200,148, 200,180);
    // Arrows: extend
    s += draw.arrow(20,80, 5,65);
    s += draw.arrow(270,100, 285,85);
    return svg(300, 220, s);
  },

  // Band exercises - generic with band
  '弹力带深蹲': () => {
    let s = draw.floor(320, 300);
    s += draw.circle(150,62, 16, GRAY);
    s += draw.line(150,78, 130,160, GRAY);
    s += draw.line(140,110, 70,110, BLUE);
    s += draw.line(140,110, 210,110, BLUE);
    s += draw.line(130,160, 90,220, BLUE);
    s += draw.line(90,220, 100,310, BLUE);
    s += draw.line(130,160, 180,220, BLUE);
    s += draw.line(180,220, 190,310, BLUE);
    // Band under feet, over shoulders
    s += draw.band('M100,310 Q90,200 90,110 Q120,70 150,90 Q180,70 210,110 Q210,200 190,310');
    s += draw.arrow(220,160, 220,200);
    return svg(300, 340, s);
  },

  '弹力带划船': () => {
    // 坐姿，弹力带绕脚，双手向后拉
    let s = draw.floor(290, 300);
    s += draw.circle(100,90, 16, GRAY);
    s += draw.line(100,106, 120,200, GRAY);
    // Arms pulling back
    s += draw.line(105,130, 60,110, BLUE);
    s += draw.line(105,135, 55,120, BLUE);
    // Band
    s += draw.band('M60,110 Q140,100 200,250');
    s += draw.band('M55,120 Q130,110 200,250');
    // Legs extended with band around feet
    s += draw.line(120,200, 170,250, GRAY);
    s += draw.line(170,250, 200,260, GRAY);
    s += draw.line(120,200, 160,260, GRAY);
    s += draw.line(160,260, 190,270, GRAY);
    // Arrow: pull back
    s += draw.arrow(60,110, 35,100);
    return svg(300, 290, s);
  },

  '弹力带侧步走': () => {
    // 弹力带套膝上，侧步走
    let s = draw.floor(310, 300);
    s += draw.circle(150,55, 16, GRAY);
    s += draw.line(150,71, 150,200, GRAY);
    s += draw.line(150,90, 110,100, GRAY);
    s += draw.line(150,90, 190,100, GRAY);
    // Legs apart (stepping side)
    s += draw.line(150,200, 70,280, BLUE);
    s += draw.line(70,280, 60,310, BLUE);
    s += draw.line(150,200, 210,280, GRAY);
    s += draw.line(210,280, 220,310, GRAY);
    // Band around thighs
    s += draw.band('M70,230 Q150,210 210,230');
    // Arrow: step out
    s += draw.arrow(60,310, 40,310);
    return svg(300, 330, s);
  },

  '弹力带肩外旋': () => {
    // 弹力带固定，肘贴身，前臂外旋
    let s = draw.floor(310, 300);
    s += draw.circle(150,55, 16, GRAY);
    s += draw.line(150,71, 150,250, GRAY);
    // Left arm: elbow at side, forearm out (active)
    s += draw.line(150,110, 110,130, BLUE); // upper arm
    s += draw.line(110,130, 60,100, BLUE); // forearm rotating out
    // Right arm at side
    s += draw.line(150,110, 190,130, GRAY);
    // Band
    s += draw.band('M60,100 Q60,60 150,50 Q240,60 240,100');
    // Ghost: forearm in (start)
    s += draw.ghostLine(110,130, 80,150);
    // Arrow: rotate out
    s += draw.arrow(60,100, 40,85);
    return svg(300, 270, s);
  },

  '弹力带二头弯举': () => {
    // 踩弹力带，双手弯举
    let s = draw.floor(310, 300);
    s += draw.circle(150,55, 16, GRAY);
    s += draw.line(150,71, 150,250, GRAY);
    // Arms curling up
    s += draw.line(150,110, 120,140, BLUE);
    s += draw.line(120,140, 130,100, BLUE); // curled up
    s += draw.line(150,110, 180,140, BLUE);
    s += draw.line(180,140, 170,100, BLUE);
    // Ghost: arms down
    s += draw.ghostLine(120,140, 120,230);
    s += draw.ghostLine(180,140, 180,230);
    // Band under feet
    s += draw.band('M130,250 L130,230 Q130,200 120,140');
    s += draw.band('M170,250 L170,230 Q170,200 180,140');
    // Legs
    s += draw.line(150,250, 120,310, GRAY);
    s += draw.line(150,250, 180,310, GRAY);
    // Arrow: up
    s += draw.arrow(130,100, 130,75);
    return svg(300, 330, s);
  },

  '弹力带推举': () => {
    // 踩弹力带，双手过头上推
    let s = draw.floor(310, 300);
    s += draw.circle(150,55, 16, GRAY);
    s += draw.line(150,71, 150,200, GRAY);
    // Arms up (press)
    s += draw.line(150,100, 110,60, BLUE);
    s += draw.line(150,100, 190,60, BLUE);
    // Ghost: arms at shoulder
    s += draw.ghostLine(150,100, 110,120);
    s += draw.ghostLine(150,100, 190,120);
    // Band under feet
    s += draw.band('M110,60 Q120,130 120,290');
    s += draw.band('M190,60 Q180,130 180,290');
    // Legs
    s += draw.line(150,200, 120,310, GRAY);
    s += draw.line(150,200, 180,310, GRAY);
    s += draw.arrow(110,60, 100,40);
    return svg(300, 330, s);
  },
};

// Generate all SVGs
fs.mkdirSync(OUT_DIR, {recursive: true});
for (const [name, fn] of Object.entries(exercises)) {
  const content = fn();
  fs.writeFileSync(path.join(OUT_DIR, `${name}.svg`), content);
}
console.log(`Generated ${Object.keys(exercises).length} exercise SVGs`);
console.log('Exercises:', Object.keys(exercises).join(', '));
