const { Engine, Render, Runner, Bodies, Composite, Constraint, Mouse, MouseConstraint, Events, Vector, Body } = Matter;

// Configuration
const CONFIG = {
    canvasWidth: 500,
    canvasHeight: 800,
    ballRadius: 10,
    flipperLength: 80,
    flipperWidth: 15,
    colors: {
        bg: '#05050a',
        ball: '#ffffff',
        flipper: '#00f2ff',
        bumper: '#ff00e6',
        wall: '#1a1a2e',
        slingshot: '#39ff14',
        shield: '#00f2ff'
    }
};

// --- Sound System ---
let audioCtx;
const initAudio = () => {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
};

const playSound = (freq, type, duration, volume = 0.1) => {
    if (!audioCtx) return;
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + duration);
    
    gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + duration);
};

const sounds = {
    bumper: () => playSound(400, 'square', 0.2),
    flipper: () => playSound(150, 'sine', 0.1),
    launch: () => playSound(200, 'sawtooth', 0.5),
    lost: () => playSound(100, 'sine', 1.0, 0.2),
    target: () => playSound(600, 'triangle', 0.15),
    shield: () => playSound(800, 'sine', 0.3)
};

// Game State
let gameState = {
    score: 0,
    ballsLeft: 3,
    launcherPower: 0,
    isLaunching: false,
    gameActive: false, // Changed to false by default
    tiltCount: 0,
    isTilted: false,
    shieldActive: false,
    shieldCharge: 0,
    playerName: '',
    highestScore: 0,
    leaderboard: JSON.parse(localStorage.getItem('neo-pinball-global-scores')) || []
};

const container = document.getElementById('game-container');
const canvas = document.getElementById('game-canvas');
const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('high-score');
const playerNameEl = document.getElementById('player-name-display');
const ballLights = document.querySelectorAll('.ball-light');
const messageEl = document.getElementById('message-display');
const launchGauge = document.getElementById('launch-gauge');
const shieldGauge = document.getElementById('shield-gauge');

// --- Custom FX Systems ---

let particles = [];
let ballTrails = [];
const PREV_POS_COUNT = 10;

const createParticles = (x, y, color) => {
    for (let i = 0; i < 15; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 1.0,
            color
        });
    }
};

const screenShake = () => {
    container.style.transform = `translate(${(Math.random()-0.5)*10}px, ${(Math.random()-0.5)*10}px)`;
    setTimeout(() => container.style.transform = 'translate(0,0)', 50);
};

const triggerGlitch = () => {
    scoreEl.classList.add('glitch');
    setTimeout(() => scoreEl.classList.remove('glitch'), 500);
};

// Initialize Engine
const engine = Engine.create();
const world = engine.world;

// Harden Physics against tunneling
engine.positionIterations = 10;
engine.velocityIterations = 10;
engine.timing.timestamp = 0;

// Initialize Renderer
const render = Render.create({
    canvas: canvas,
    engine: engine,
    options: {
        width: CONFIG.canvasWidth,
        height: CONFIG.canvasHeight,
        wireframes: false,
        background: 'transparent',
        pixelRatio: window.devicePixelRatio,
        showSleeping: false,
        showVelocity: false
    }
});

Events.on(render, 'afterRender', (event) => {
    const ctx = render.context;
    if (!ctx) return;
    
    try {
        // Draw Particles
        if (particles && particles.length > 0) {
            particles = particles.filter(p => p && p.life > 0);
            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                p.life -= 0.02;
                ctx.fillStyle = p.color;
                ctx.globalAlpha = Math.max(0, p.life);
                ctx.beginPath();
                ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.globalAlpha = 1.0;
        }

        // Draw Ball Trails
        if (ball && ball.position) {
            ballTrails.push({ x: ball.position.x, y: ball.position.y });
            if (ballTrails.length > PREV_POS_COUNT) ballTrails.shift();
            
            ballTrails.forEach((pos, i) => {
                const alpha = i / PREV_POS_COUNT * 0.3;
                ctx.fillStyle = `rgba(0, 242, 255, ${alpha})`;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, CONFIG.ballRadius * (i / PREV_POS_COUNT), 0, Math.PI * 2);
                ctx.fill();
            });
        }

        // Draw Inner Bumper Details
        const allBodies = Composite.allBodies(world);
        allBodies.forEach(body => {
            if (body && body.label === 'bumper') {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(body.position.x, body.position.y, 15, 0, Math.PI * 2);
                ctx.stroke();
            }
            
            // Draw Premium Teardrop Flipper Overlay
            if (body && body.label === 'flipper') {
                ctx.save();
                ctx.translate(body.position.x, body.position.y);
                ctx.rotate(body.angle);
                
                // Shadow/Base
                ctx.fillStyle = '#111';
                drawTeardrop(ctx, CONFIG.flipperLength, 15, 8);
                ctx.fill();
                
                // Top Surface
                ctx.translate(0, -2);
                ctx.fillStyle = '#eee';
                drawTeardrop(ctx, CONFIG.flipperLength - 4, 12, 6);
                ctx.fill();
                
                // Highlight
                ctx.fillStyle = 'rgba(255,255,255,0.4)';
                ctx.beginPath();
                ctx.ellipse(-15, 0, 8, 4, 0, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.restore();
            }
        });
    } catch (e) {
        // Silent fail
    }
});

// Helper for Teardrop shape
function drawTeardrop(ctx, length, r1, r2) {
    ctx.beginPath();
    ctx.arc(-length/2 + r1, 0, r1, Math.PI/2, Math.PI * 1.5);
    ctx.lineTo(length/2 - r2, -r2);
    ctx.arc(length/2 - r2, 0, r2, -Math.PI/2, Math.PI/2);
    ctx.lineTo(-length/2 + r1, r1);
    ctx.closePath();
}

Render.run(render);
const runner = Runner.create();
Runner.run(runner, engine);

// --- Error Logger (Debug) ---
window.onerror = (msg, url, line) => {
    const errorMsg = `ERROR: ${msg} [Line: ${line}]`;
    console.error(errorMsg);
    messageEl.textContent = 'ERR: ' + msg.split(':')[0];
    messageEl.classList.add('show');
    messageEl.style.fontSize = '1.5rem';
    messageEl.style.color = '#ff0000';
    return false;
};

// --- Create Table ---

const createTable = () => {
    // Outer Walls (Thickened for no-leakage)
    const wallOptions = { isStatic: true, render: { fillStyle: CONFIG.colors.wall } };
    const leftWall = Bodies.rectangle(-40, CONFIG.canvasHeight / 2, 100, CONFIG.canvasHeight, wallOptions);
    const rightWall = Bodies.rectangle(CONFIG.canvasWidth + 40, CONFIG.canvasHeight / 2, 100, CONFIG.canvasHeight, wallOptions);
    const topWall = Bodies.rectangle(CONFIG.canvasWidth / 2, -40, CONFIG.canvasWidth + 200, 100, wallOptions);
    const bottomWall = Bodies.rectangle(CONFIG.canvasWidth / 2, CONFIG.canvasHeight + 100, CONFIG.canvasWidth + 200, 200, wallOptions);
    
    // Launcher Tube & Bottom (Optimized to prevent pockets)
    const launcherWall = Bodies.rectangle(CONFIG.canvasWidth - 55, CONFIG.canvasHeight - 230, 20, 460, wallOptions);
    const launcherBottom = Bodies.rectangle(CONFIG.canvasWidth - 25, CONFIG.canvasHeight - 2, 60, 20, wallOptions);
    
    // Top Right Launcher Curve
    const curveSegments = [];
    const centerX = CONFIG.canvasWidth - 105;
    const centerY = 120;
    const radius = 95;
    const startAngle = 0;
    const endAngle = -Math.PI / 2;
    const steps = 15;

    for (let i = 0; i <= steps; i++) {
        const angle = startAngle + (endAngle - startAngle) * (i / steps);
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        curveSegments.push(Bodies.rectangle(x, y, 20, 10, {
            isStatic: true,
            angle: angle + Math.PI / 2,
            render: { fillStyle: CONFIG.colors.wall, strokeStyle: CONFIG.colors.flipper, lineWidth: 1 }
        }));
    }
    
    // Bottom Incline (Moved slightly to ensure gap)
    const leftIncline = Bodies.rectangle(80, CONFIG.canvasHeight - 40, 260, 40, { 
        isStatic: true, angle: Math.PI / 6, render: { fillStyle: CONFIG.colors.wall } 
    });
    const rightIncline = Bodies.rectangle(CONFIG.canvasWidth - 145, CONFIG.canvasHeight - 40, 250, 40, { 
        isStatic: true, angle: -Math.PI / 6, render: { fillStyle: CONFIG.colors.wall } 
    });

    Composite.add(world, [leftWall, rightWall, topWall, bottomWall, launcherWall, launcherBottom, leftIncline, rightIncline, ...curveSegments]);

    // Bumpers
    const createBumper = (x, y) => {
        const bumper = Bodies.circle(x, y, 25, {
            isStatic: true,
            label: 'bumper',
            restitution: 1.5,
            render: { 
                fillStyle: 'transparent',
                strokeStyle: CONFIG.colors.bumper,
                lineWidth: 4
            }
        });
        return bumper;
    };

    const b1 = createBumper(150, 200);
    const b2 = createBumper(300, 200);
    const b3 = createBumper(225, 300);
    Composite.add(world, [b1, b2, b3]);

    // Slingshots (Replaced fromVertices with simple polygons)
    const createSlingshot = (x, y, angle) => {
        const slingshot = Bodies.rectangle(x, y, 60, 20, {
            isStatic: true,
            angle: angle,
            label: 'slingshot',
            render: { fillStyle: 'transparent', strokeStyle: CONFIG.colors.slingshot, lineWidth: 3 }
        });
        return slingshot;
    };

    const s1 = createSlingshot(80, 520, Math.PI / 4 + 0.2);
    const s2 = createSlingshot(370, 520, -Math.PI / 4 - 0.2);
    Composite.add(world, [s1, s2]);

    const stopperOptions = { isStatic: true, render: { visible: false } };
    // Left Stoppers (Up and Down)
    const leftStopUp = Bodies.circle(180, 630, 10, stopperOptions);
    const leftStopDown = Bodies.circle(180, 720, 10, stopperOptions);
    // Right Stoppers (Up and Down)
    const rightStopUp = Bodies.circle(320, 630, 10, stopperOptions);
    const rightStopDown = Bodies.circle(320, 720, 10, stopperOptions);
    Composite.add(world, [leftStopUp, leftStopDown, rightStopUp, rightStopDown]);

    // Drop Targets (Right side wall)
    for (let i = 0; i < 3; i++) {
        const target = Bodies.rectangle(420, 150 + i * 40, 10, 30, {
            isStatic: true,
            label: 'dropTarget',
            render: { fillStyle: CONFIG.colors.flipper, strokeStyle: '#fff', lineWidth: 2 }
        });
        Composite.add(world, target);
    }
};

// --- Flippers ---

let leftFlipper, rightFlipper;
const createFlippers = () => {
    const group = Body.nextGroup(true);
    
    // Flipper Geometry Constants
    const flipY = CONFIG.canvasHeight - 110;
    const leftFlipPivotX = 145;
    const rightFlipPivotX = 295;
    
    // Tapered vertices for physics
    const getFlipperVertices = (isLeft) => {
        const l = CONFIG.flipperLength;
        const w1 = 25, w2 = 12;
        return [
            { x: -l/2, y: -w1/2 }, { x: -l/2, y: w1/2 },
            { x: l/2, y: w2/2 }, { x: l/2, y: -w2/2 }
        ];
    };

    // Left Flipper
    leftFlipper = Bodies.fromVertices(leftFlipPivotX + 40, flipY, [getFlipperVertices(true)], {
        collisionFilter: { group: group },
        angle: 0.4,
        label: 'flipper',
        render: { visible: false } // Custom drawn in afterRender
    });
    
    const leftPivot = Constraint.create({
        bodyB: leftFlipper,
        pointB: { x: -CONFIG.flipperLength / 2 + 12, y: 0 },
        pointA: { x: leftFlipPivotX, y: flipY },
        stiffness: 1, length: 0, render: { visible: false }
    });

    // Right Flipper
    rightFlipper = Bodies.fromVertices(rightFlipPivotX - 40, flipY, [getFlipperVertices(false)], {
        collisionFilter: { group: group },
        angle: -0.4,
        label: 'flipper',
        render: { visible: false }
    });
    
    const rightPivot = Constraint.create({
        bodyB: rightFlipper,
        pointB: { x: CONFIG.flipperLength / 2 - 12, y: 0 },
        pointA: { x: rightFlipPivotX, y: flipY },
        stiffness: 1, length: 0, render: { visible: false }
    });

    Composite.add(world, [leftFlipper, leftPivot, rightFlipper, rightPivot]);
};

// --- Ball ---

let ball;
const spawnBall = () => {
    if (ball) Composite.remove(world, ball);
    
    ball = Bodies.circle(CONFIG.canvasWidth - 30, CONFIG.canvasHeight - 50, CONFIG.ballRadius, {
        restitution: 0.1, // Initial soft launch
        friction: 0,
        frictionAir: 0,
        collisionFilter: { group: 0 },
        label: 'ball',
        render: {
            fillStyle: CONFIG.colors.ball,
            shadowBlur: 10,
            shadowColor: '#fff'
        }
    });
    
    Composite.add(world, ball);
    showMessage('READY');
};

// --- Controls ---

const keys = {};
document.addEventListener('keydown', (e) => {
    if (!gameState.gameActive) return;
    initAudio(); 
    if (gameState.isTilted) return;
    keys[e.code] = true;
    
    if (e.code === 'Space' && !gameState.isLaunching) {
        gameState.isLaunching = true;
    }
    
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        applyTilt();
    }
    
    if (e.code === 'KeyR') {
        restartGame();
    }
});

let tiltResetTimer;
const applyTilt = () => {
    if (gameState.isTilted) return;
    
    gameState.tiltCount++;
    // Apply random nudge
    const nudge = { x: (Math.random() - 0.5) * 0.005, y: (Math.random() - 0.5) * 0.005 };
    Body.applyForce(ball, ball.position, nudge);
    
    if (gameState.tiltCount > 3) {
        gameState.isTilted = true;
        showMessage('TILT!', 3000);
        setTimeout(() => {
            gameState.isTilted = false;
            gameState.tiltCount = 0;
        }, 3000);
    }
    
    clearTimeout(tiltResetTimer);
    tiltResetTimer = setTimeout(() => { gameState.tiltCount = 0; }, 2000);
};

document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'Space' && gameState.isLaunching) {
        launchBall();
    }
});

const updateFlippers = () => {
    if (gameState.isTilted) {
        // Drop flippers
        Body.setAngularVelocity(leftFlipper, 0.1);
        Body.setAngularVelocity(rightFlipper, -0.1);
        return;
    }
    const strength = 0.15;
    const limit = 0.6;
    
    if (keys['KeyA'] || keys['ArrowLeft']) {
        Body.setAngularVelocity(leftFlipper, -strength);
        if (leftFlipper.angularVelocity < -0.1) sounds.flipper();
    } else {
        Body.setAngularVelocity(leftFlipper, strength);
    }
    
    if (keys['KeyD'] || keys['ArrowRight']) {
        Body.setAngularVelocity(rightFlipper, strength);
        if (rightFlipper.angularVelocity > 0.1) sounds.flipper();
    } else {
        Body.setAngularVelocity(rightFlipper, -strength);
    }
};

const updateLauncher = () => {
    if (gameState.isLaunching) {
        gameState.launcherPower = Math.min(gameState.launcherPower + 0.02, 1);
        launchGauge.style.width = (gameState.launcherPower * 100) + '%';
    }
};

const launchBall = () => {
    const power = gameState.launcherPower;
    const force = -0.05 * power;
    
    // Skill Shot check (Sweet spot between 0.8 and 0.9)
    if (power > 0.8 && power < 0.9) {
        updateScore(5000);
        showMessage('SKILL SHOT!', 1500);
    } else {
        showMessage('GO!', 500);
    }

    Body.applyForce(ball, ball.position, { x: 0, y: force });
    sounds.launch();
    
    gameState.isLaunching = false;
    gameState.launcherPower = 0;
    launchGauge.style.width = '0%';
};

const showMessage = (text, duration = 1000) => {
    messageEl.textContent = text;
    messageEl.classList.add('show');
    setTimeout(() => {
        messageEl.classList.remove('show');
    }, duration);
};

// --- Game Logic ---

const updateScore = (points) => {
    if (points > 0) {
        gameState.score += points;
        scoreEl.textContent = gameState.score.toLocaleString().padStart(7, '0');
        if (points >= 500) triggerGlitch();
    }
};

// Collision Events
Events.on(engine, 'collisionStart', (event) => {
    const pairs = event.pairs;
    pairs.forEach((pair) => {
        const labels = [pair.bodyA.label, pair.bodyB.label];
        
        if (labels.includes('bumper')) {
            updateScore(100);
            const body = pair.bodyA.label === 'bumper' ? pair.bodyA : pair.bodyB;
            flashBody(body, CONFIG.colors.bumper);
            createParticles(body.position.x, body.position.y, CONFIG.colors.bumper);
            screenShake();
            sounds.bumper();
        }
        
        if (labels.includes('slingshot')) {
            updateScore(50);
            const slingshot = pair.bodyA.label === 'slingshot' ? pair.bodyA : pair.bodyB;
            const normal = pair.collision.normal;
            Body.applyForce(ball, ball.position, Vector.mult(normal, -0.02));
            flashBody(slingshot, CONFIG.colors.slingshot);
            createParticles(ball.position.x, ball.position.y, CONFIG.colors.slingshot);
            sounds.bumper();
        }

        if (labels.includes('dropTarget')) {
            const target = pair.bodyA.label === 'dropTarget' ? pair.bodyA : pair.bodyB;
            updateScore(500);
            createParticles(target.position.x, target.position.y, CONFIG.colors.flipper);
            triggerGlitch();
            Composite.remove(world, target);
            sounds.target();
            checkAllTargetsDown();
        }
    });
});

const flashBody = (body, color) => {
    const original = body.render.fillStyle;
    body.render.fillStyle = color;
    setTimeout(() => {
        body.render.fillStyle = 'transparent';
    }, 100);
};

let targetsDown = 0;
const checkAllTargetsDown = () => {
    targetsDown++;
    if (targetsDown >= 3) {
        showMessage('MULTI-BALL!', 2000);
        spawnExtraBall();
        targetsDown = 0;
        // Re-spawn targets after 5 seconds
        setTimeout(respawnTargets, 5000);
    }
};

const respawnTargets = () => {
    for (let i = 0; i < 3; i++) {
        const target = Bodies.rectangle(420, 150 + i * 40, 10, 30, {
            isStatic: true,
            label: 'dropTarget',
            render: { fillStyle: CONFIG.colors.flipper, strokeStyle: '#fff', lineWidth: 2 }
        });
        Composite.add(world, target);
    }
};

const spawnExtraBall = () => {
    const extraBall = Bodies.circle(250, 400, CONFIG.ballRadius, {
        restitution: 0.8,
        label: 'ball',
        render: { fillStyle: CONFIG.colors.ball, shadowBlur: 10, shadowColor: '#fff' }
    });
    Composite.add(world, extraBall);
};

// Outhole & Stuck check
Events.on(engine, 'afterUpdate', () => {
    if (!gameState.gameActive) return;
    
    // 1. Outhole check
    if (ball.position.y > CONFIG.canvasHeight + 50) {
        if (gameState.shieldActive) {
            Body.setVelocity(ball, { x: 0, y: -15 });
            gameState.shieldActive = false;
            showMessage('SHIELD USED!');
        } else {
            handleBallLost();
        }
    }
    
    // 2. Out of bounds (Top/Sides) recovery
    if (ball.position.y < -100 || ball.position.x < -100 || ball.position.x > CONFIG.canvasWidth + 100) {
        Body.setPosition(ball, { x: CONFIG.canvasWidth / 2, y: 100 });
        Body.setVelocity(ball, { x: 0, y: 5 });
        showMessage('RECOVERED');
    }

    // 3. Max Velocity Capping & Anti-Stuck
    const maxVelocity = 20;
    const currentVelocity = Vector.magnitude(ball.velocity);
    
    // Speed cap
    if (currentVelocity > maxVelocity) {
        const ratio = maxVelocity / currentVelocity;
        Body.setVelocity(ball, { x: ball.velocity.x * ratio, y: ball.velocity.y * ratio });
    }

    // Anti-Stuck Nudge: If ball is active but barely moving
    if (gameState.gameActive && currentVelocity < 0.1 && ball.position.y < CONFIG.canvasHeight - 100) {
        if (!ball.stuckFrames) ball.stuckFrames = 0;
        ball.stuckFrames++;
        if (ball.stuckFrames > 120) { // Approx 2 seconds
            Body.applyForce(ball, ball.position, { x: (Math.random()-0.5)*0.002, y: -0.002 });
            ball.stuckFrames = 0;
        }
    } else {
        ball.stuckFrames = 0;
    }
    updateFlippers();
    updateLauncher();
    updateShield();
});

const updateShield = () => {
    if (!gameState.shieldActive && gameState.shieldCharge < 100) {
        gameState.shieldCharge += 0.05;
        shieldGauge.style.width = gameState.shieldCharge + '%';
        
        if (gameState.shieldCharge >= 100) {
            gameState.shieldActive = true;
            shieldGauge.classList.add('ready');
            sounds.shield();
            showMessage('SHIELD READY', 1000);
        }
    } else if (!gameState.shieldActive) {
        shieldGauge.style.width = '0%';
        shieldGauge.classList.remove('ready');
        gameState.shieldCharge = 0;
    }
};

const handleBallLost = () => {
    gameState.ballsLeft--;
    updateBallLights();
    
    if (gameState.ballsLeft > 0) {
        spawnBall();
    } else {
        showMessage('GAME OVER - PRESS R', 5000);
        gameState.gameActive = false;
        checkHighScore();
    }
};

const checkHighScore = () => {
    // Add current run to leaderboard
    gameState.leaderboard.push({ name: gameState.playerName, score: gameState.score });
    
    // Sort and keep top 20
    gameState.leaderboard.sort((a, b) => b.score - a.score);
    gameState.leaderboard = gameState.leaderboard.slice(0, 20);
    
    localStorage.setItem('neo-pinball-global-scores', JSON.stringify(gameState.leaderboard));
    
    // Update Highest Personal Score for display
    const personalRanks = gameState.leaderboard.filter(r => r.name === gameState.playerName);
    if (personalRanks.length > 0) {
        gameState.highestScore = personalRanks[0].score;
        highScoreEl.textContent = gameState.highestScore.toLocaleString();
    }
    
    updateLeaderboardUI();
    
    if (gameState.score >= gameState.highestScore) {
        showMessage('NEW RECORD!', 3000);
        triggerGlitch();
    }
};

const updateLeaderboardUI = () => {
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';
    gameState.leaderboard.forEach((entry, i) => {
        const item = document.createElement('div');
        item.className = `rank-item ${i < 3 ? 'top' : ''}`;
        item.innerHTML = `<span>${i+1}. ${entry.name}</span> <span>${entry.score.toLocaleString()}</span>`;
        list.appendChild(item);
    });
};

const restartGame = () => {
    gameState.score = 0;
    gameState.ballsLeft = 3;
    gameState.gameActive = true;
    gameState.shieldActive = false;
    gameState.shieldCharge = 0;
    updateScore(0);
    updateBallLights();
    spawnBall();
    showMessage('RESTARTED!', 2000);
    
    // Remove tutorial overlay if it exists
    const overlay = document.getElementById('start-overlay');
    if (overlay) overlay.remove();
};

const updateBallLights = () => {
    ballLights.forEach((light, index) => {
        if (index < gameState.ballsLeft) {
            light.classList.add('active');
        } else {
            light.classList.remove('active');
        }
    });
};

// Initialize
const init = () => {
    createTable();
    createFlippers();
    spawnBall();
    updateScore(0);
    updateBallLights();
    
    // UI Setup
    updateLeaderboardUI();
    document.getElementById('user-modal').style.display = 'flex';

    // Modal Events
    document.getElementById('start-register-btn').addEventListener('click', () => {
        const input = document.getElementById('username-input');
        if (input.value.trim().length > 0) {
            gameState.playerName = input.value.trim();
            playerNameEl.textContent = gameState.playerName;
            
            // Show personal best if returning player
            const pastEntry = gameState.leaderboard.find(r => r.name === gameState.playerName);
            if (pastEntry) {
                gameState.highestScore = pastEntry.score;
                highScoreEl.textContent = gameState.highestScore.toLocaleString();
            } else {
                gameState.highestScore = 0;
                highScoreEl.textContent = '0';
            }

            document.getElementById('user-modal').style.display = 'none';
            initAudio();
        }
    });
    
    // Add Start Overlay
    const overlay = document.createElement('div');
    overlay.id = 'start-overlay';
    overlay.innerHTML = `
        <div class="neon-text" style="font-family: Orbitron; font-size: 2rem; cursor: pointer;">
            CLICK TO START
        </div>
    `;
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'rgba(0,0,0,0.8)';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '100';
    document.getElementById('game-container').appendChild(overlay);
    
    overlay.addEventListener('click', () => {
        initAudio();
        overlay.remove();
        gameState.gameActive = true;
        showMessage('GET READY!', 2000);
    });
};

init();
