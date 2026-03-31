    // ════════════════════════════════════════════════════
    // INIT
    // ════════════════════════════════════════════════════

    // Scroll to center of canvas world so objects can be placed in any direction
    cv.scrollLeft = WORLD_W / 2 - cv.clientWidth / 2;
    cv.scrollTop  = WORLD_H / 2 - cv.clientHeight / 2;

    updateEmpty();
    requestAnimationFrame(phLoop);
    initMidi();
