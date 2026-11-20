/**
 * 智能盲人导航助手 - 核心应用
 * 使用浏览器端AI模型进行实时物体检测和盲道方向分析
 */

class BlindAssistApp {
  constructor() {
    // DOM 元素
    this.video = document.getElementById('video');
    this.canvas = document.getElementById('overlay');
    this.ctx = this.canvas.getContext('2d');
    this.statusDot = document.getElementById('statusDot');
    this.statusText = document.getElementById('statusText');
    this.directionArrow = document.getElementById('directionArrow');
    this.arrowGroup = document.getElementById('arrowGroup');
    this.directionLabel = document.getElementById('directionLabel');
    this.directionConfidence = document.getElementById('directionConfidence');
    this.subtitleText = document.getElementById('subtitleText');
    this.subtitleBar = document.getElementById('subtitleBar');
    this.startBtn = document.getElementById('startBtn');
    this.muteBtn = document.getElementById('muteBtn');
    this.settingsBtn = document.getElementById('settingsBtn');
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.loadingText = document.getElementById('loadingText');
    this.settingsModal = document.getElementById('settingsModal');
    
    // 信息面板元素
    this.blindwayInfo = document.getElementById('blindwayInfo');
    this.crosswalkInfo = document.getElementById('crosswalkInfo');
    this.trafficInfo = document.getElementById('trafficInfo');
    this.obstacleInfo = document.getElementById('obstacleInfo');
    
    // 设置项
    this.settings = {
      interval: 3000,
      rate: 1.0,
      sensitivity: 0.5,
      camera: 'environment',
      obstacleAlert: true,
      showBox: true
    };
    
    // 状态
    this.isRunning = false;
    this.isMuted = false;
    this.model = null;
    this.stream = null;
    this.lastSpeakTime = 0;
    this.lastDirection = null;
    this.detectionLoop = null;
    this.currentDetections = [];
    this.blindwayDirection = null;
    
    // 障碍物类别映射
    this.obstacleCategories = {
      'person': '行人',
      'bicycle': '自行车',
      'car': '汽车',
      'motorcycle': '摩托车',
      'bus': '公交车',
      'truck': '卡车',
      'chair': '椅子',
      'couch': '沙发',
      'bench': '长椅',
      'backpack': '背包',
      'handbag': '手提包',
      'suitcase': '行李箱',
      'bottle': '瓶子',
      'cup': '杯子',
      'umbrella': '雨伞',
      'stop sign': '停车标志',
      'fire hydrant': '消防栓',
      'traffic light': '红绿灯',
      'parking meter': '停车计时器'
    };
    
    // 语音合成
    this.synth = window.speechSynthesis;
    this.speechQueue = [];
    this.isSpeaking = false;
    
    this.init();
  }
  
  async init() {
    // 绑定事件
    this.startBtn.addEventListener('click', () => this.toggleCamera());
    this.muteBtn.addEventListener('click', () => this.toggleMute());
    this.settingsBtn.addEventListener('click', () => this.openSettings());
    document.getElementById('closeSettings').addEventListener('click', () => this.closeSettings());
    document.getElementById('voiceBtn').addEventListener('click', () => this.repeatLastMessage());
    
    // 设置事件
    document.getElementById('intervalSelect').addEventListener('change', (e) => {
      this.settings.interval = parseInt(e.target.value) * 1000;
    });
    document.getElementById('rateSlider').addEventListener('input', (e) => {
      this.settings.rate = parseFloat(e.target.value);
      document.getElementById('rateValue').textContent = this.settings.rate.toFixed(1);
    });
    document.getElementById('sensitivitySelect').addEventListener('change', (e) => {
      this.settings.sensitivity = parseFloat(e.target.value);
    });
    document.getElementById('cameraSelect').addEventListener('change', (e) => {
      this.settings.camera = e.target.value;
      if (this.isRunning) {
        this.restartCamera();
      }
    });
    document.getElementById('obstacleToggle').addEventListener('change', (e) => {
      this.settings.obstacleAlert = e.target.checked;
    });
    document.getElementById('boxToggle').addEventListener('change', (e) => {
      this.settings.showBox = e.target.checked;
      if (!e.target.checked) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    });
    
    // 预加载模型
    await this.loadModel();
  }
  
  async loadModel() {
    try {
      this.loadingText.textContent = '正在加载AI模型...';
      // 设置后端
      await tf.setBackend('webgl');
      await tf.ready();
      
      // 加载COCO-SSD模型
      this.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      
      this.loadingText.textContent = '模型加载完成！';
      this.statusText.textContent = '模型已就绪';
      this.statusDot.classList.add('active');
      
      setTimeout(() => {
        this.loadingOverlay.classList.add('hidden');
      }, 500);
      
      this.speak('智能盲人导航助手已准备就绪，请点击开启镜头按钮开始使用', true);
    } catch (error) {
      console.error('模型加载失败:', error);
      this.loadingText.textContent = '模型加载失败';
      this.loadingText.style.color = '#FF5252';
      this.speak('模型加载失败，请检查网络后刷新页面', true);
    }
  }
  
  async toggleCamera() {
    if (this.isRunning) {
      this.stopCamera();
    } else {
      await this.startCamera();
    }
  }
  
  async startCamera() {
    try {
      this.loadingOverlay.classList.remove('hidden');
      this.loadingText.textContent = '正在开启摄像头...';
      
      const constraints = {
        video: {
          facingMode: this.settings.camera,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };
      
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      
      await new Promise((resolve) => {
        this.video.onloadedmetadata = resolve;
      });
      
      // 设置canvas尺寸
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;
      
      this.loadingOverlay.classList.add('hidden');
      
      this.isRunning = true;
      this.startBtn.classList.add('active');
      this.startBtn.querySelector('span').textContent = '停止';
      this.statusText.textContent = '正在识别...';
      this.statusDot.classList.add('active');
      
      this.speak('镜头已开启，开始识别盲道和周围环境', true);
      
      // 开始检测循环
      this.startDetection();
    } catch (error) {
      console.error('摄像头开启失败:', error);
      this.loadingOverlay.classList.add('hidden');
      this.speak('摄像头开启失败，请允许摄像头权限', true);
      this.updateSubtitle('摄像头开启失败，请检查权限');
    }
  }
  
  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.isRunning = false;
    this.startBtn.classList.remove('active');
    this.startBtn.querySelector('span').textContent = '开启镜头';
    this.statusText.textContent = '已停止';
    this.statusDot.classList.remove('active');
    this.statusDot.classList.add('warning');
    
    if (this.detectionLoop) {
      cancelAnimationFrame(this.detectionLoop);
      this.detectionLoop = null;
    }
    
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.updateSubtitle('镜头已关闭');
    this.speak('镜头已关闭', true);
    
    // 重置信息
    this.resetInfo();
  }
  
  async restartCamera() {
    this.stopCamera();
    setTimeout(() => this.startCamera(), 300);
  }
  
  startDetection() {
    const detect = async () => {
      if (!this.isRunning || !this.model) {
        return;
      }
      
      try {
        // COCO-SSD物体检测
        const predictions = await this.model.detect(this.video, 20, this.settings.sensitivity);
        this.currentDetections = predictions;
        
        // 分析盲道方向
        this.blindwayDirection = this.analyzeBlindway();
        
        // 绘制检测框
        if (this.settings.showBox) {
          this.drawDetections(predictions);
        } else {
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        
        // 更新界面
        this.updateInfo(predictions);
        this.updateDirection();
        
        // 语音播报
        const now = Date.now();
        if (now - this.lastSpeakTime >= this.settings.interval) {
          const message = this.generateVoiceMessage(predictions);
          if (message) {
            this.speak(message);
            this.lastSpeakTime = now;
          }
        }
        
        // 紧急播报
        this.checkUrgentAlerts(predictions);
        
      } catch (error) {
        console.error('检测错误:', error);
      }
      
      this.detectionLoop = requestAnimationFrame(detect);
    };
    
    detect();
  }
  
  /**
   * 分析盲道方向
   * 通过分析画面底部的黄色线条方向来判断
   */
  analyzeBlindway() {
    if (!this.video.videoWidth) return null;
    
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    
    // 创建临时canvas用于图像分析
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(this.video, 0, 0, w, h);
    
    // 采样画面下半部分（盲道通常在脚下）
    const regionY = Math.floor(h * 0.5);
    const regionH = Math.floor(h * 0.5);
    const imageData = tempCtx.getImageData(0, regionY, w, regionH);
    const data = imageData.data;
    
    // 寻找黄色盲道像素（盲道通常为黄色）
    const yellowPoints = [];
    const step = 4; // 采样步长
    
    for (let y = 0; y < regionH; y += step) {
      for (let x = 0; x < w; x += step) {
        const idx = (y * w + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        // 黄色检测：R高, G高, B低
        if (r > 150 && g > 120 && b < 100 && r > b && g > b) {
          yellowPoints.push({ x: x, y: y + regionY });
        }
      }
    }
    
    if (yellowPoints.length < 30) {
      // 没有检测到足够的黄色像素，尝试检测灰色/浅色引导线
      return this.detectGuidingLine(imageData, w, regionH, regionY);
    }
    
    // 分析黄色点的分布来判断方向
    return this.calculateDirection(yellowPoints, w, h);
  }
  
  /**
   * 检测引导线（灰色或浅色的引导路径）
   */
  detectGuidingLine(imageData, w, regionH, regionY) {
    const data = imageData.data;
    const linePoints = [];
    const step = 4;
    
    for (let y = 0; y < regionH; y += step) {
      const rowBright = [];
      for (let x = 0; x < w; x += step) {
        const idx = (y * w + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const brightness = (r + g + b) / 3;
        rowBright.push({ x, brightness });
      }
      
      // 找到该行中最亮的连续区域
      rowBright.sort((a, b) => b.brightness - a.brightness);
      const threshold = rowBright[0].brightness * 0.7;
      const brightPoints = rowBright.filter(p => p.brightness > threshold && p.brightness > 120);
      
      if (brightPoints.length > 0) {
        const avgX = brightPoints.reduce((sum, p) => sum + p.x, 0) / brightPoints.length;
        linePoints.push({ x: avgX, y: y + regionY });
      }
    }
    
    if (linePoints.length < 5) {
      return { direction: 'none', confidence: 0 };
    }
    
    return this.calculateDirection(linePoints, w, regionY + regionH);
  }
  
  /**
   * 根据点的分布计算盲道方向
   */
  calculateDirection(points, imgW, imgH) {
    // 计算点的中心
    const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    
    // 使用线性回归分析方向趋势
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    points.forEach(p => {
      sumX += p.x;
      sumY += p.y;
      sumXY += p.x * p.y;
      sumX2 += p.x * p.x;
    });
    
    const n = points.length;
    const denominator = n * sumX2 - sumX * sumX;
    
    let angle = 0;
    if (Math.abs(denominator) > 0.001) {
      const slope = (n * sumXY - sumX * sumY) / denominator;
      angle = Math.atan(slope) * (180 / Math.PI);
    }
    
    // 判断盲道在画面中的位置
    const imgCenterX = imgW / 2;
    const offsetX = centerX - imgCenterX;
    const offsetRatio = offsetX / imgCenterX;
    
    // 置信度计算
    const spread = this.calculateSpread(points);
    const confidence = Math.min(0.95, Math.max(0.3, 1 - spread / (imgW * 0.5)));
    
    // 判断方向
    let direction, rotation;
    
    if (Math.abs(offsetRatio) < 0.15) {
      // 盲道在画面中央，方向向前
      direction = 'straight';
      rotation = 0;
    } else if (offsetRatio < -0.15 && offsetRatio > -0.4) {
      // 盲道偏左
      direction = 'left';
      rotation = -45;
    } else if (offsetRatio <= -0.4) {
      // 盲道在左侧远处
      direction = 'far-left';
      rotation = -80;
    } else if (offsetRatio > 0.15 && offsetRatio < 0.4) {
      // 盲道偏右
      direction = 'right';
      rotation = 45;
    } else if (offsetRatio >= 0.4) {
      // 盲道在右侧远处
      direction = 'far-right';
      rotation = 80;
    } else {
      direction = 'straight';
      rotation = 0;
    }
    
    // 如果角度变化大，说明有转弯
    if (Math.abs(angle) > 30 && Math.abs(offsetRatio) < 0.3) {
      if (angle > 0) {
        direction = 'turn-right';
        rotation = 90;
      } else {
        direction = 'turn-left';
        rotation = -90;
      }
    }
    
    return {
      direction,
      rotation,
      confidence,
      centerX,
      centerY,
      pointCount: points.length
    };
  }
  
  calculateSpread(points) {
    if (points.length < 2) return 0;
    const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    let variance = 0;
    points.forEach(p => {
      variance += Math.pow(p.x - centerX, 2);
    });
    return Math.sqrt(variance / points.length);
  }
  
  /**
   * 绘制检测结果
   */
  drawDetections(predictions) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    predictions.forEach(pred => {
      const [x, y, w, h] = pred.bbox;
      const isTraffic = pred.class === 'traffic light';
      const isCrosswalk = pred.class === 'stop sign'; // 简化处理
      const isObstacle = this.obstacleCategories[pred.class] && 
                         !['traffic light', 'stop sign'].includes(pred.class);
      
      let color, label;
      
      if (isTraffic) {
        // 分析红绿灯颜色
        const lightColor = this.analyzeTrafficLight(pred.bbox);
        color = lightColor === 'red' ? '#FF5252' : 
                lightColor === 'green' ? '#00E676' : '#FFD740';
        label = `红绿灯: ${lightColor === 'red' ? '红灯' : lightColor === 'green' ? '绿灯' : '黄灯'} ${Math.round(pred.score * 100)}%`;
      } else if (isObstacle) {
        color = '#FF9800';
        label = `${this.obstacleCategories[pred.class]} ${Math.round(pred.score * 100)}%`;
      } else {
        color = '#448AFF';
        label = `${pred.class} ${Math.round(pred.score * 100)}%`;
      }
      
      // 绘制检测框
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = 3;
      this.ctx.strokeRect(x, y, w, h);
      
      // 绘制标签背景
      this.ctx.fillStyle = color;
      this.ctx.fillRect(x, y - 24, this.ctx.measureText(label).width + 16, 24);
      
      // 绘制标签文字
      this.ctx.fillStyle = '#000';
      this.ctx.font = '14px sans-serif';
      this.ctx.fillText(label, x + 8, y - 8);
      
      // 绘制距离指示
      const distance = this.estimateDistance(pred.bbox);
      if (distance) {
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x + w - 60, y + h - 24, 60, 24);
        this.ctx.fillStyle = '#000';
        this.ctx.fillText(`~${distance}m`, x + w - 52, y + h - 8);
      }
    });
    
    // 绘制盲道引导线
    if (this.blindwayDirection && this.blindwayDirection.direction !== 'none') {
      this.drawBlindwayPath();
    }
  }
  
  /**
   * 绘制盲道路径
   */
  drawBlindwayPath() {
    const dir = this.blindwayDirection;
    const w = this.canvas.width;
    const h = this.canvas.height;
    
    this.ctx.strokeStyle = 'rgba(0, 230, 118, 0.6)';
    this.ctx.lineWidth = 5;
    this.ctx.setLineDash([15, 8]);
    
    // 绘制盲道方向指示线
    this.ctx.beginPath();
    this.ctx.moveTo(dir.centerX, h);
    
    const endY = Math.max(0, dir.centerY - 100);
    const endX = dir.centerX + (dir.rotation / 90) * (h - endY) * 0.3;
    
    this.ctx.lineTo(endX, endY);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    
    // 绘制方向箭头
    this.ctx.fillStyle = 'rgba(0, 230, 118, 0.8)';
    this.ctx.beginPath();
    const arrowSize = 20;
    this.ctx.moveTo(endX, endY - arrowSize);
    this.ctx.lineTo(endX - arrowSize/2, endY);
    this.ctx.lineTo(endX + arrowSize/2, endY);
    this.ctx.closePath();
    this.ctx.fill();
  }
  
  /**
   * 分析红绿灯颜色
   */
  analyzeTrafficLight(bbox) {
    const [x, y, w, h] = bbox;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(this.video, x, y, w, h, 0, 0, w, h);
    
    const imageData = tempCtx.getImageData(0, 0, w, h);
    const data = imageData.data;
    
    let redScore = 0, greenScore = 0, yellowScore = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // 红色检测
      if (r > 150 && g < 100 && b < 100) redScore++;
      // 绿色检测
      if (g > 150 && r < 120 && b < 120) greenScore++;
      // 黄色检测
      if (r > 150 && g > 150 && b < 100) yellowScore++;
    }
    
    if (redScore > greenScore && redScore > yellowScore) return 'red';
    if (greenScore > redScore && greenScore > yellowScore) return 'green';
    if (yellowScore > redScore && yellowScore > greenScore) return 'yellow';
    return 'unknown';
  }
  
  /**
   * 估算距离
   */
  estimateDistance(bbox) {
    const [x, y, w, h] = bbox;
    // 基于物体高度估算距离（简化模型）
    const refHeight = 400; // 参考高度
    const distFactor = refHeight / h;
    const distance = Math.round(distFactor * 1.5);
    return Math.min(50, Math.max(1, distance));
  }
  
  /**
   * 更新信息面板
   */
  updateInfo(predictions) {
    // 盲道信息
    if (this.blindwayDirection && this.blindwayDirection.direction !== 'none') {
      const dirText = this.getDirectionText(this.blindwayDirection.direction);
      this.blindwayInfo.querySelector('.info-text').textContent = `盲道: ${dirText}`;
      this.blindwayInfo.classList.add('detected');
    } else {
      this.blindwayInfo.querySelector('.info-text').textContent = '盲道: 未检测';
      this.blindwayInfo.classList.remove('detected');
    }
    
    // 斑马线信息
    const crosswalk = predictions.find(p => p.class === 'stop sign' || this.isCrosswalk(p));
    if (crosswalk) {
      const dist = this.estimateDistance(crosswalk.bbox);
      this.crosswalkInfo.querySelector('.info-text').textContent = `斑马线: ${dist}米`;
      this.crosswalkInfo.classList.add('detected');
    } else {
      this.crosswalkInfo.querySelector('.info-text').textContent = '斑马线: 未检测';
      this.crosswalkInfo.classList.remove('detected');
    }
    
    // 红绿灯信息
    const trafficLight = predictions.find(p => p.class === 'traffic light');
    if (trafficLight) {
      const lightColor = this.analyzeTrafficLight(trafficLight.bbox);
      const lightText = lightColor === 'red' ? '红灯停' : 
                       lightColor === 'green' ? '绿灯行' : 
                       lightColor === 'yellow' ? '黄灯等' : '未知';
      this.trafficInfo.querySelector('.info-text').textContent = `红绿灯: ${lightText}`;
      this.trafficInfo.classList.remove('warning', 'danger');
      if (lightColor === 'red') {
        this.trafficInfo.classList.add('danger');
      } else if (lightColor === 'green') {
        this.trafficInfo.classList.add('detected');
      } else {
        this.trafficInfo.classList.add('warning');
      }
    } else {
      this.trafficInfo.querySelector('.info-text').textContent = '红绿灯: 未检测';
      this.trafficInfo.classList.remove('detected', 'warning', 'danger');
    }
    
    // 障碍物信息
    const obstacles = predictions.filter(p => 
      this.obstacleCategories[p.class] && 
      !['traffic light', 'stop sign'].includes(p.class)
    );
    if (obstacles.length > 0 && this.settings.obstacleAlert) {
      const nearest = obstacles.reduce((min, p) => {
        const dist = this.estimateDistance(p.bbox);
        return !min || dist < this.estimateDistance(min.bbox) ? p : min;
      }, null);
      const dist = this.estimateDistance(nearest.bbox);
      const obstacleName = this.obstacleCategories[nearest.class];
      this.obstacleInfo.querySelector('.info-text').textContent = `${obstacleName}: ${dist}米`;
      
      this.obstacleInfo.classList.remove('warning', 'danger');
      if (dist <= 3) {
        this.obstacleInfo.classList.add('danger');
      } else if (dist <= 5) {
        this.obstacleInfo.classList.add('warning');
      }
    } else {
      this.obstacleInfo.querySelector('.info-text').textContent = '障碍物: 安全';
      this.obstacleInfo.classList.remove('warning', 'danger');
    }
  }
  
  isCrosswalk(pred) {
    // 通过检测大面积的白色条纹来判断斑马线
    const [x, y, w, h] = pred.bbox;
    return w > 100 && h > 50 && pred.class === 'stop sign';
  }
  
  /**
   * 更新方向指示器
   */
  updateDirection() {
    if (!this.blindwayDirection || this.blindwayDirection.direction === 'none') {
      this.directionLabel.textContent = '未检测到盲道';
      this.directionLabel.className = 'direction-label warning';
      this.directionConfidence.textContent = '';
      this.arrowGroup.setAttribute('transform', 'rotate(0 100 100)');
      return;
    }
    
    const dir = this.blindwayDirection;
    const dirText = this.getDirectionText(dir.direction);
    this.directionLabel.textContent = dirText;
    this.directionLabel.className = 'direction-label';
    
    // 旋转箭头
    this.arrowGroup.setAttribute('transform', `rotate(${dir.rotation} 100 100)`);
    
    // 置信度
    this.directionConfidence.textContent = `置信度 ${Math.round(dir.confidence * 100)}%`;
    
    // 根据方向调整颜色
    const arrowPath = this.arrowGroup.querySelector('path');
    if (dir.direction === 'straight') {
      arrowPath.setAttribute('fill', '#00E676');
      this.directionArrow.classList.add('straight');
    } else if (dir.direction.includes('left') || dir.direction.includes('right')) {
      arrowPath.setAttribute('fill', '#FFD740');
      this.directionArrow.classList.remove('straight');
      this.directionLabel.classList.add('warning');
    } else if (dir.direction === 'turn-left' || dir.direction === 'turn-right') {
      arrowPath.setAttribute('fill', '#FF5252');
      this.directionArrow.classList.remove('straight');
      this.directionLabel.classList.add('danger');
    }
  }
  
  getDirectionText(direction) {
    const texts = {
      'straight': '前方直行',
      'left': '左前方',
      'right': '右前方',
      'far-left': '左侧',
      'far-right': '右侧',
      'turn-left': '左转',
      'turn-right': '右转',
      'none': '未检测到'
    };
    return texts[direction] || '未知方向';
  }
  
  /**
   * 生成语音播报消息
   */
  generateVoiceMessage(predictions) {
    let messages = [];
    
    // 盲道方向
    if (this.blindwayDirection && this.blindwayDirection.direction !== 'none') {
      const dirText = this.getDirectionText(this.blindwayDirection.direction);
      if (this.blindwayDirection.direction === 'straight') {
        messages.push(`盲道在正前方，请继续直行`);
      } else if (this.blindwayDirection.direction.includes('left')) {
        messages.push(`盲道在${dirText}，请向左调整方向`);
      } else if (this.blindwayDirection.direction.includes('right')) {
        messages.push(`盲道在${dirText}，请向右调整方向`);
      } else if (this.blindwayDirection.direction === 'turn-left') {
        messages.push(`前方盲道左转，请注意左转`);
      } else if (this.blindwayDirection.direction === 'turn-right') {
        messages.push(`前方盲道右转，请注意右转`);
      }
    } else {
      // 没有检测到盲道
      messages.push('前方未检测到盲道，请注意周围环境');
    }
    
    // 红绿灯
    const trafficLight = predictions.find(p => p.class === 'traffic light');
    if (trafficLight) {
      const lightColor = this.analyzeTrafficLight(trafficLight.bbox);
      const dist = this.estimateDistance(trafficLight.bbox);
      if (lightColor === 'red') {
        messages.push(`前方${dist}米红灯，请停下等待`);
      } else if (lightColor === 'green') {
        messages.push(`前方${dist}米绿灯，可以通行`);
      } else if (lightColor === 'yellow') {
        messages.push(`前方${dist}米黄灯，请准备停下`);
      }
    }
    
    // 斑马线
    const crosswalk = predictions.find(p => p.class === 'stop sign');
    if (crosswalk) {
      const dist = this.estimateDistance(crosswalk.bbox);
      messages.push(`前方${dist}米有斑马线`);
    }
    
    // 障碍物（只播报近距离的）
    if (this.settings.obstacleAlert) {
      const obstacles = predictions.filter(p => 
        this.obstacleCategories[p.class] && 
        !['traffic light', 'stop sign'].includes(p.class)
      );
      
      obstacles.forEach(obs => {
        const dist = this.estimateDistance(obs.bbox);
        if (dist <= 5) {
          const name = this.obstacleCategories[obs.class];
          // 判断障碍物在画面中的位置
          const [x, y, w, h] = obs.bbox;
          const centerX = x + w / 2;
          const pos = centerX < this.canvas.width / 3 ? '左方' :
                      centerX > this.canvas.width * 2 / 3 ? '右方' : '正前方';
          messages.push(`${pos}${dist}米有${name}`);
        }
      });
    }
    
    return messages.join('，');
  }
  
  /**
   * 检查紧急情况并立即播报
   */
  checkUrgentAlerts(predictions) {
    const now = Date.now();
    if (now - this.lastSpeakTime < 1500) return; // 避免过于频繁
    
    // 紧急障碍物（2米内）
    if (this.settings.obstacleAlert) {
      const urgentObstacles = predictions.filter(p => {
        if (!this.obstacleCategories[p.class]) return false;
        if (['traffic light', 'stop sign'].includes(p.class)) return false;
        const dist = this.estimateDistance(p.bbox);
        return dist <= 2;
      });
      
      if (urgentObstacles.length > 0) {
        const obs = urgentObstacles[0];
        const name = this.obstacleCategories[obs.class];
        const [x, y, w, h] = obs.bbox;
        const centerX = x + w / 2;
        const pos = centerX < this.canvas.width / 3 ? '左方' :
                    centerX > this.canvas.width * 2 / 3 ? '右方' : '正前方';
        this.speak(`注意！${pos}1米内有${name}，请停下`, true);
        this.updateSubtitle(`⚠️ 警告：${pos}有${name}！`, true);
        this.lastSpeakTime = now;
        return;
      }
    }
    
    // 红灯紧急提醒
    const trafficLight = predictions.find(p => p.class === 'traffic light');
    if (trafficLight) {
      const lightColor = this.analyzeTrafficLight(trafficLight.bbox);
      const dist = this.estimateDistance(trafficLight.bbox);
      if (lightColor === 'red' && dist <= 3) {
        this.speak(`红灯，请停下等待`, true);
        this.updateSubtitle(`🔴 红灯，请停下！`, true);
        this.lastSpeakTime = now;
        return;
      }
    }
  }
  
  /**
   * 语音播报
   */
  speak(text, priority = false) {
    if (this.isMuted) return;
    
    if (priority) {
      // 优先消息：中断当前播报
      this.synth.cancel();
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = this.settings.rate;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    // 尝试使用中文语音
    const voices = this.synth.getVoices();
    const zhVoice = voices.find(v => v.lang.startsWith('zh'));
    if (zhVoice) {
      utterance.voice = zhVoice;
    }
    
    this.synth.speak(utterance);
    this.updateSubtitle(text);
  }
  
  /**
   * 更新字幕
   */
  updateSubtitle(text, isAlert = false) {
    this.subtitleText.textContent = text;
    if (isAlert) {
      this.subtitleBar.classList.add('alert');
    } else {
      this.subtitleBar.classList.remove('alert');
    }
  }
  
  repeatLastMessage() {
    if (this.currentDetections.length > 0) {
      const message = this.generateVoiceMessage(this.currentDetections);
      this.speak(message, true);
    } else {
      this.speak('暂无可播报的信息', true);
    }
  }
  
  toggleMute() {
    this.isMuted = !this.isMuted;
    this.muteBtn.classList.toggle('muted', this.isMuted);
    if (this.isMuted) {
      this.synth.cancel();
      this.updateSubtitle('语音已静音');
    } else {
      this.speak('语音已开启', true);
    }
  }
  
  openSettings() {
    this.settingsModal.classList.add('show');
  }
  
  closeSettings() {
    this.settingsModal.classList.remove('show');
  }
  
  resetInfo() {
    this.blindwayInfo.querySelector('.info-text').textContent = '盲道: 未检测';
    this.crosswalkInfo.querySelector('.info-text').textContent = '斑马线: 未检测';
    this.trafficInfo.querySelector('.info-text').textContent = '红绿灯: 未检测';
    this.obstacleInfo.querySelector('.info-text').textContent = '障碍物: 安全';
    this.directionLabel.textContent = '等待识别';
    this.directionConfidence.textContent = '';
    this.arrowGroup.setAttribute('transform', 'rotate(0 100 100)');
    
    [this.blindwayInfo, this.crosswalkInfo, this.trafficInfo, this.obstacleInfo].forEach(el => {
      el.classList.remove('detected', 'warning', 'danger');
    });
  }
}

// 启动应用
window.addEventListener('DOMContentLoaded', () => {
  const app = new BlindAssistApp();
  
  // 处理语音列表加载
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  }
  
  // 处理页面可见性变化
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && app.isRunning) {
      app.stopCamera();
    }
  });
});
