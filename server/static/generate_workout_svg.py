#!/usr/bin/env python3
"""批量生成二次元风格运动插画SVG卡片"""
import os
import json

OUTPUT_DIR = "/root/claw-todo/server/static/img/workout_anime"

# 运动数据：名称 -> (分类, 颜色主题, 简笔画姿势描述)
EXERCISES = {
    # 核心觉醒
    "死虫式": ("core", "#ff6b9d", "supine_arms_legs"),
    "平板支撑": ("core", "#ff6b9d", "plank"),
    "鸟狗式": ("core", "#ff6b9d", "bird_dog"),
    "仰卧卷腹": ("core", "#ff6b9d", "crunch"),
    "臀桥": ("core", "#ff6b9d", "glute_bridge"),
    
    # 颈肩
    "颈部侧拉伸": ("neck", "#c084fc", "neck_stretch"),
    "弹力带肩外旋": ("neck", "#c084fc", "band_rotation"),
    "W-Y伸展": ("neck", "#c084fc", "wy_stretch"),
    "门框胸肌拉伸": ("neck", "#c084fc", "doorway_stretch"),
    "弹力带面拉": ("neck", "#c084fc", "face_pull"),
    
    # 髋部
    "低弓步拉伸": ("hip", "#4ade80", "lunge_stretch"),
    "鸽子式": ("hip", "#4ade80", "pigeon"),
    "弹力带髋外展": ("hip", "#4ade80", "hip_abduction"),
    "青蛙式": ("hip", "#4ade80", "frog_stretch"),
    "弹力带臀桥外展": ("hip", "#4ade80", "bridge_abduction"),
    
    # 背部
    "猫牛式": ("back", "#60a5fa", "cat_cow"),
    "超人式": ("back", "#60a5fa", "superman"),
    "超人式保持": ("back", "#60a5fa", "superman_hold"),
    "靠墙天使": ("back", "#60a5fa", "wall_angel"),
    "反向雪天使": ("back", "#60a5fa", "snow_angel"),
    "山羊挺身模拟": ("back", "#60a5fa", "back_extension"),
    
    # 上肢
    "俯卧撑": ("upper", "#f97316", "pushup"),
    "阻力俯卧撑": ("upper", "#f97316", "band_pushup"),
    "俯卧撑跳转": ("upper", "#f97316", "pushup_jump"),
    "开合跳俯卧撑": ("upper", "#f97316", "jump_pushup"),
    "弹力带胸推": ("upper", "#f97316", "band_press"),
    "弹力带扩胸": ("upper", "#f97316", "band_fly"),
    "弹力带弯举": ("upper", "#f97316", "bicep_curl"),
    "弹力带三头下压": ("upper", "#f97316", "tricep_push"),
    "弹力带肩推": ("upper", "#f97316", "shoulder_press"),
    "弹力带侧平举": ("upper", "#f97316", "lateral_raise"),
    "弹力带引体模拟": ("upper", "#f97316", "band_pullup"),
    "弹力带单臂划船": ("upper", "#f97316", "one_arm_row"),
    "弹力带划船": ("upper", "#f97316", "band_row"),
    "弹力带划船+深蹲": ("upper", "#f97316", "row_squat"),
    "弹力带肩胛后缩": ("upper", "#f97316", "scapula_retract"),
    "弹力带反向飞鸟": ("upper", "#f97316", "reverse_fly"),
    "弹力带直臂下压": ("upper", "#f97316", "straight_push"),
    "弹力带YTW伸展": ("upper", "#f97316", "ytw_stretch"),
    "弹力带AB轮模拟": ("upper", "#f97316", "ab_wheel"),
    "弹力带站姿抗旋": ("upper", "#f97316", "anti_rotation"),
    "弹力带站姿侧屈": ("upper", "#f97316", "side_bend"),
    "弹力带冲刺": ("upper", "#f97316", "band_sprint"),
    "前臂拉伸": ("upper", "#f97316", "forearm_stretch"),
    "弹力带腕伸展": ("upper", "#f97316", "wrist_ext"),
    "弹力带腕屈曲": ("upper", "#f97316", "wrist_flex"),
    "手指张开弹力带": ("upper", "#f97316", "finger_spread"),
    "手腕绕圈": ("upper", "#f97316", "wrist_circle"),
    "下巴后缩": ("upper", "#f97316", "chin_tuck"),
    
    # 下肢
    "深蹲": ("lower", "#22d3ee", "squat"),
    "深蹲跳": ("lower", "#22d3ee", "squat_jump"),
    "箭步蹲": ("lower", "#22d3ee", "lunge"),
    "箭步跳": ("lower", "#22d3ee", "lunge_jump"),
    "跳跃箭步蹲": ("lower", "#22d3ee", "jump_lunge"),
    "保加利亚分腿蹲": ("lower", "#22d3ee", "bulgarian_squat"),
    "单腿硬拉": ("lower", "#22d3ee", "single_leg_dl"),
    "单腿提踵": ("lower", "#22d3ee", "calf_raise"),
    "提踵": ("lower", "#22d3ee", "calf_raise2"),
    "弹力带深蹲": ("lower", "#22d3ee", "band_squat"),
    "弹力带深蹲推举": ("lower", "#22d3ee", "squat_press"),
    "弹力带深蹲跳": ("lower", "#22d3ee", "band_squat_jump"),
    "弹力带硬拉": ("lower", "#22d3ee", "band_deadlift"),
    "弹力带侧步行走": ("lower", "#22d3ee", "lateral_walk"),
    "弹力带臀kickback": ("lower", "#22d3ee", "kickback"),
    "弹力带臀桥": ("lower", "#22d3ee", "band_bridge"),
    "弹力带开合跳": ("lower", "#22d3ee", "band_jumping_jack"),
    "弹力带俄罗斯转体": ("lower", "#22d3ee", "band_russian_twist"),
    "弹力带卷腹": ("lower", "#22d3ee", "band_crunch"),
    "弹力带死虫式": ("lower", "#22d3ee", "band_deadbug"),
    "高抬腿": ("lower", "#22d3ee", "high_knees"),
    "开合跳": ("lower", "#22d3ee", "jumping_jack"),
    "快速登山者": ("lower", "#22d3ee", "mountain_climber"),
    "登山者": ("lower", "#22d3ee", "mountain_climber2"),
    "波比跳": ("lower", "#22d3ee", "burpee"),
    "波比+俯卧撑": ("lower", "#22d3ee", "burpee_pushup"),
    "波比+跳高": ("lower", "#22d3ee", "burpee_jump"),
    "平板爬行": ("lower", "#22d3ee", "plank_walk"),
    "平板转侧平板": ("lower", "#22d3ee", "plank_side"),
    "侧平板支撑": ("lower", "#22d3ee", "side_plank"),
    "侧平板抬腿": ("lower", "#22d3ee", "side_plank_leg"),
    "平板支撑60秒": ("lower", "#22d3ee", "plank_60"),
    "空心体保持": ("lower", "#22d3ee", "hollow_body"),
    "V字支撑": ("lower", "#22d3ee", "v_sit"),
    "俄罗斯转体": ("lower", "#22d3ee", "russian_twist"),
    "自行车卷腹": ("lower", "#22d3ee", "bicycle_crunch"),
    "仰卧抬腿": ("lower", "#22d3ee", "leg_raise"),
    "悬垂举腿模拟": ("lower", "#22d3ee", "hanging_leg"),
    "龙旗退阶": ("lower", "#22d3ee", "dragon_flag"),
    "游泳式": ("lower", "#22d3ee", "swimmer"),
    
    # 拉伸
    "婴儿式": ("stretch", "#a78bfa", "child_pose"),
    "下犬式": ("stretch", "#a78bfa", "downward_dog"),
    "眼镜蛇式": ("stretch", "#a78bfa", "cobra"),
    "祈祷式拉伸": ("stretch", "#a78bfa", "prayer_stretch"),
    "快乐婴儿式": ("stretch", "#a78bfa", "happy_baby"),
    "蝴蝶式": ("stretch", "#a78bfa", "butterfly"),
    "脊柱扭转": ("stretch", "#a78bfa", "spinal_twist"),
    "胸椎伸展": ("stretch", "#a78bfa", "thoracic_ext"),
    "胸椎旋转": ("stretch", "#a78bfa", "thoracic_rot"),
    "腘绳肌拉伸": ("stretch", "#a78bfa", "hamstring_stretch"),
    "弹力带肩外旋": ("stretch", "#a78bfa", "band_ext_rot"),
}

# 姿势SVG片段（简笔画人物）
POSES = {
    "supine_arms_legs": '''<g transform="translate(100,160) rotate(-90)">
        <line x1="0" y1="0" x2="0" y2="-40" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
        <line x1="0" y1="-40" x2="-25" y2="-55" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="0" y1="-40" x2="25" y2="-55" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="0" y1="0" x2="-20" y2="15" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="0" y1="0" x2="20" y2="15" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="0" cy="-50" r="8" fill="#fff"/>
    </g>''',
    
    "plank": '''<g transform="translate(100,170)">
        <line x1="-30" y1="0" x2="30" y2="0" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
        <line x1="-30" y1="0" x2="-30" y2="15" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="30" y1="0" x2="40" y2="15" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="-35" cy="-8" r="8" fill="#fff"/>
    </g>''',
    
    "bird_dog": '''<g transform="translate(100,165)">
        <line x1="-20" y1="0" x2="20" y2="0" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
        <line x1="-20" y1="0" x2="-20" y2="15" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="20" y1="0" x2="20" y2="15" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="-20" y1="0" x2="-40" y2="-15" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="20" y1="0" x2="40" y2="-15" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="-22" cy="-8" r="8" fill="#fff"/>
    </g>''',
    
    "crunch": '''<g transform="translate(100,170)">
        <path d="M-15,10 Q0,-10 15,10" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
        <line x1="-15" y1="10" x2="-25" y2="20" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="15" y1="10" x2="25" y2="20" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="0" cy="-15" r="8" fill="#fff"/>
    </g>''',
    
    "glute_bridge": '''<g transform="translate(100,175)">
        <path d="M-25,10 Q0,-15 25,10" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
        <line x1="-25" y1="10" x2="-25" y2="25" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="25" y1="10" x2="25" y2="25" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="-30" cy="5" r="8" fill="#fff"/>
    </g>''',
    
    "default": '''<g transform="translate(100,160)">
        <line x1="0" y1="0" x2="0" y2="-35" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
        <line x1="0" y1="-25" x2="-15" y2="-35" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="0" y1="-25" x2="15" y2="-35" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="0" y1="0" x2="-12" y2="18" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="0" y1="0" x2="12" y2="18" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="0" cy="-42" r="8" fill="#fff"/>
    </g>''',
}

# 分类图标
CAT_ICONS = {
    "core": "💪",
    "neck": "🦢",
    "hip": "🦵",
    "back": "🛡️",
    "upper": "💪",
    "lower": "🦵",
    "stretch": "🧘",
}

# 分类背景渐变
CAT_GRADIENTS = {
    "core": ("#1a1a2e", "#2d1b4e"),
    "neck": ("#1a1a2e", "#1b2d4e"),
    "hip": ("#1a1a2e", "#1b4e2d"),
    "back": ("#1a1a2e", "#1b3d4e"),
    "upper": ("#1a1a2e", "#4e2d1b"),
    "lower": ("#1a1a2e", "#1b4e4e"),
    "stretch": ("#1a1a2e", "#3d1b4e"),
}

def generate_svg(name, category, color, pose_key):
    bg1, bg2 = CAT_GRADIENTS.get(category, ("#1a1a2e", "#2d1b4e"))
    icon = CAT_ICONS.get(category, "💪")
    pose = POSES.get(pose_key, POSES["default"])
    
    # 装饰粒子
    particles = ""
    import random
    random.seed(hash(name))
    for i in range(6):
        px = random.randint(20, 180)
        py = random.randint(20, 180)
        pr = random.uniform(1, 3)
        po = random.uniform(0.1, 0.3)
        particles += f'<circle cx="{px}" cy="{py}" r="{pr}" fill="{color}" opacity="{po}"/>'
    
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:{bg1}"/>
      <stop offset="100%" style="stop-color:{bg2}"/>
    </linearGradient>
  </defs>
  
  <rect width="200" height="200" rx="12" fill="url(#bg)"/>
  
  <!-- 装饰 -->
  {particles}
  
  <!-- 底部色条 -->
  <rect x="0" y="185" width="200" height="15" rx="0 0 12 12" fill="{color}" opacity="0.3"/>
  
  <!-- 人物姿势 -->
  {pose}
  
  <!-- 动作名称 -->
  <text x="100" y="198" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="10" font-weight="bold" opacity="0.9">{name}</text>
</svg>'''


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # 生成所有运动图片
    for name, (cat, color, pose) in EXERCISES.items():
        svg = generate_svg(name, cat, color, pose)
        filename = f"{name}.svg"
        filepath = os.path.join(OUTPUT_DIR, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(svg)
    
    # 对于不在列表中的运动，用默认姿势生成
    all_exercises = [
        "V字支撑", "W-Y伸展", "下巴后缩", "下犬式", "仰卧卷腹", "仰卧抬腿",
        "低弓步拉伸", "侧平板抬腿", "侧平板支撑", "俄罗斯转体", "保加利亚分腿蹲",
        "俯卧撑", "俯卧撑跳转", "前臂拉伸", "单腿提踵", "单腿硬拉",
        "反向雪天使", "婴儿式", "山羊挺身模拟", "平板支撑", "平板支撑60秒",
        "平板爬行", "平板转侧平板", "开合跳", "开合跳俯卧撑",
        "弹力带AB轮模拟", "弹力带YTW伸展", "弹力带三头下压", "弹力带侧平举",
        "弹力带侧步行走", "弹力带俄罗斯转体", "弹力带冲刺", "弹力带划船+深蹲",
        "弹力带划船", "弹力带单臂划船", "弹力带卷腹", "弹力带反向飞鸟",
        "弹力带开合跳", "弹力带引体模拟", "弹力带弯举", "弹力带扩胸",
        "弹力带死虫式", "弹力带深蹲", "弹力带深蹲推举", "弹力带深蹲跳",
        "弹力带直臂下压", "弹力带硬拉", "弹力带站姿侧屈", "弹力带站姿抗旋",
        "弹力带肩外旋", "弹力带肩推", "弹力带肩胛后缩", "弹力带胸推",
        "弹力带腕伸展", "弹力带腕屈曲", "弹力带臀kickback", "弹力带臀桥",
        "弹力带臀桥外展", "弹力带面拉", "弹力带髋外展", "快乐婴儿式",
        "快速登山者", "悬垂举腿模拟", "手指张开弹力带", "手腕绕圈", "提踵",
        "死虫式", "波比+俯卧撑", "波比+跳高", "波比跳", "深蹲", "深蹲跳",
        "游泳式", "猫牛式", "登山者", "眼镜蛇式", "祈祷式拉伸",
        "空心体保持", "箭步跳", "箭步蹲", "胸椎伸展", "胸椎旋转",
        "脊柱扭转", "腘绳肌拉伸", "臀桥", "自行车卷腹", "蝴蝶式",
        "超人式", "超人式保持", "跳跃箭步蹲", "门框胸肌拉伸", "阻力俯卧撑",
        "青蛙式", "靠墙天使", "颈部侧拉伸", "高抬腿", "鸟狗式", "鸽子式", "龙旗退阶"
    ]
    
    for name in all_exercises:
        if name not in EXERCISES:
            # 根据名称推断分类
            if "弹力带" in name:
                cat, color = "upper", "#f97316"
            elif any(k in name for k in ["拉伸", "式", "扭转", "伸展"]):
                cat, color = "stretch", "#a78bfa"
            elif any(k in name for k in ["蹲", "腿", "提踵", "跳"]):
                cat, color = "lower", "#22d3ee"
            else:
                cat, color = "core", "#ff6b9d"
            svg = generate_svg(name, cat, color, "default")
            filepath = os.path.join(OUTPUT_DIR, f"{name}.svg")
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(svg)
    
    print(f"Generated {len(all_exercises)} SVG files in {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
