# 进度条渲染 · 第二批（progress-live2）参考对照表

> 用户硬要求：「先搜集真实参考，再动手设计」。
> 下面是这次真正用到的参考，**每一行都写清"它做对了什么"和"我们借了哪个具体手法"**。
>
> ⚠️ 诚实声明：本轮的视觉理解后端全部返回 `VISION_UNSUPPORTED_BACKEND`（全部 vision 模型被限流），
> 所以**这些参考我是读文字说明 + 技术描述得到的，没有逐张看图**。下面引用的都是可点开的原文链接，
> 其中"手法"一栏来自原文里对几何结构的明确描述，不是我的印象。

---

## 一、直接采用（4 条，一一对应 4 套新方案）

### R1 · 航空姿态仪 attitude indicator —— → 方案① LADDER

| 项 | 内容 |
|---|---|
| 来源 | [Attitude indicator — Wikipedia](https://en.wikipedia.org/wiki/Attitude_indicator) ；[Flight instruments — Wikipedia](https://en.wikipedia.org/wiki/Flight_instruments) |
| 它做对了什么 | 用一个**会动的球**（不是会动的指针）承载全部姿态信息：上半蓝=天、下半棕=地，中间一条地平线；**机翼符号和顶部背向标是钉死不动的**，读数通过地平线的**平移**产生。刻度梯（pitch ladder）在中线两侧给出度数参照，两侧还有对称的角形小勾。原文："An adjustment knob … moves the aircraft up and down to align it against the horizon bar. The top half of the instrument is blue to represent the sky, while the bottom half is brown to represent the ground. The bank index at the top shows the aircraft angle of bank. Reference lines in the middle indicate the degree of pitch." |
| 我们借了什么 | ① **"基准动、指针静"** 的构图（现有 12 套全部是"指针动、刻度静"）；② 地平线本身画成一条**带刻度的面**（密排横线 + 两侧小勾 + 两侧数字 + 色域分界），而不是一根线；③ 完成态＝"球回正"（地面退出、地平线锁中位），语义天然存在，不用外挂装饰 |
| 为什么这条值得抄 | 它是**唯一一类把"进度"编码成'某个平面沉到了哪里'**的真实仪表。我们熟悉的进度条全是"长度/角度"，这是第三种编码方式 |
| 同族延伸 | 阿波罗飞船的 **FDAI（Flight Director Attitude Indicator，俗称 8-ball）**同一族，加上了 yaw 的第三维 |

### R2 · 航空 HSI 水平状态指示器 —— → 方案② AZIMUTH

| 项 | 内容 |
|---|---|
| 来源 | [Horizontal situation indicator — Wikipedia](https://en.wikipedia.org/wiki/Horizontal_situation_indicator) |
| 它做对了什么 | **把两个互不相干的读数塞进同一个圆里**：一个**会转的罗盘卡**（heading）+ 一个**只做平移的航道偏差杆**（course deviation）。原文："the aircraft is represented by a schematic figure in the centre of the instrument – the VOR-ILS display is shown in relation to this figure"；罗盘卡 slaved 到远端磁罗盘，中心是固定飞机符号 |
| 我们借了什么 | ① **双自由度同心构图**：卡转（总进度）+ 杆移（离目标的偏差），这是现有 12 套里**完全没有**的（每套都只有一个自由度）；② 主指针不用三角形，改成**竖直长杆 + 上下双 V 尖**（形状记忆点来自"跑道中线"）；③ 固定 **lubber line** 作为"零点参照" |
| 为什么这条值得抄 | 它证明一个圆可以同时承载两条进度轴而不打架 —— 这正是用户想要的"零件能拼"的物理基础 |

### R3 · 粒子物理事件显示（气泡室 / 火花室径迹图） —— → 方案③ FAN

| 项 | 内容 |
|---|---|
| 来源 | [CERN 图像资源 / 事件显示传统](https://home.cern/) ；这一类图像的通用名是 bubble chamber / spark chamber event display |
| 它做对了什么 | 一次事件被画成**从同一个顶点发散出去的一圈径迹**：每条径迹长度不同、带轻微弯折、末端常有一个小点（衰变/散射点）。形成的是**不规则星芒**，而不是整齐的辐射状（后者是 wind-rose / radial bar chart 的语汇） |
| 我们借了什么 | ① **长短不一 + 抖动** 的 26 条径迹（刻意和规整扫掠拉开距离）；② 每条径迹用 **userSpaceOnUse 径向渐变**：根部亮、末端化进背景（能量从顶点散出）；③ 末端像素点；④ 完成态＝"径迹长到捕获虚线环" |
| 为什么这条值得抄 | 它给了"发散"这个动作一个**非几何**的原型 —— 轮廓的参差感是真实测量数据的特征，抄不像，只能生成 |

### R4 · 摩尔干涉 / "猫眼"调谐指示管 —— → 方案④ MOIRE

| 项 | 内容 |
|---|---|
| 来源 | [FUI 风格指南（环形仪表与遥测一节）](https://designbycurio.com/zh/learn/fui-sci-fi-hud) 给了 FUI 的仪器语汇与"扫描运动"的定位；本方案的光学原型是 classic **magic eye / tuning indicator**（阴极射线式调谐管）里那对**张角随失谐量变化的阴影扇**，以及**双光栅摩尔纹** |
| 它做对了什么 | 它**不画形状，只叠两组周期**：一组固定的同心栅 + 一组周期略差的同心栅。人眼看到的是**涌现出来的粗条纹和中心那个"目/眼"**，这些条纹在 DOM 里根本不存在。调谐管的阴影角同理：一个扇形的张角直接就是"离谐振还差多少" |
| 我们借了什么 | ① **两层同心环栅（静态栅 A 步长 9.2 / 动态栅 B 步长 6.05）**，进度＝B 整组缩放、即两层周期差；② 中心"目"的直径即读数；③ 完成态＝**栅全部收进圆心**（scale→0.02）后淡出，留一个实心亮盘 —— "干涉收束成一个点" |
| 为什么这条值得抄 | 它提供了一种**完全不同的编码哲学**：读数不由"画出来的东西"给出，而由**两组东西之间的差**涌现出来。这在方案库里是独一份 |
| 已知风险 | 摩尔纹对采样率极敏感：缩到 40px 以下、或在高 DPI 缩放链上会被重采样抵消成灰噪声。页面上已如实标注为"不推荐组合"之一 |

---

## 二、读过并明确"不采用"（同样是判断力的体现）

| 来源 | 它做对了什么 | 为什么**没有**采用 |
|---|---|---|
| [FUI Sci-Fi HUD 风格指南](https://designbycurio.com/zh/learn/fui-sci-fi-hud) 的整体语汇：虚空黑 + 青色发光、线框线性、环形仪表、雷达网格、微型数字、层叠指挥层级 | 把"密度 + 扫描运动"当作**气氛**而非信息 —— 原文明确批评："最常见的错误，是把 FUI 理解成可以在每块黑色表面上堆满发光线条与微小标签的许可。没有层级的密度只是装饰" | 这套是**风格底色**，不是形态。第一批的 orbital/nebula/radar 已经吃掉了它的"环形仪表 + 扫描"部分。我们把它降级为**配色与描边纪律**（青 #56d9c8 / 暗青描边 / 等宽数字），不再重复它的形态 |
| [Data Visualisation Catalogue](https://datavizcatalogue.com/) / [everviz 图表清单（Sankey / Polar / Radial / Wind rose / Dependency wheel / Dumbbell / Streamgraph…）](https://www.everviz.com/chart-examples/more-charts/) | 系统整理了"径向""极坐标""流向"等图表的适用场景 | 这些是**统计图表**：形式服务于可比较性，形状天生"通用"。直接搬过来就是第二批被用户否掉的老路（"形状本身太普通"）。**结论：图表库不能当形态灵感源** |
| 航空 **CDI 航道偏差点阵**（5 点横排刻度） | 用一排疏密点表示偏离量，极简 | 单个点阵太弱，撑不住 140px 的主图标。**降级处理**：只用它做"杆底下的 7 颗点"，当 P2 的辅料 |
| 旧式 **机械计数器 / 里程表转鼓** | 数字轮真实转动，机械感强 | 形状＝并排矩形数字轮，视觉上就是"一个数字框"，不够特别；且数字轮会对刻度感造成干扰。放弃 |
| **地震仪 helicorder 螺旋纸记录** | 一根线在鼓面上绕螺旋，时间被卷起来 | 形态确实少见，但它是**时间序列**而非**进度**；读"完成度"要在螺旋上量弧长，人眼做不到。放弃 |

---

## 三、从参考到设计的映射（一句话）

| 方案 | 真实原型 | 借鉴的那一个手法 | 形态结果 |
|---|---|---|---|
| ① LADDER | 姿态仪 / Apollo FDAI | 动的是"基准面"而不是"指针" | 一条带刻度的地平线在圆的窗口里下移 |
| ② AZIMUTH | HSI | 一个圆里两条正交读数轴 | 罗盘卡转 + 偏差杆横移 |
| ③ FAN | 粒子事件径迹图 | 不等长 + 抖动的发散径迹 | 26 根参差射线撑出一片不规则星芒 |
| ④ MOIRE | magic eye / 双光栅摩尔纹 | 读数由"两组周期的差"涌现 | 中心那只随进度长大又收走的"目" |

**共同点：先有一个真实存在的仪器或物理现象，形状从那里长出来 —— 而不是先起个好听的名字再去找形状。**
