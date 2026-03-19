const sharp = require('sharp');

// 使用 300 DPI 的密度读取 SVG，确保滤镜（发光和阴影）在高分辨率下依然锐利
sharp('icon.svg', { density: 300 })
    .resize(256, 256) // 提升到 256x256，适配高分屏
    .png()
    .toFile('icon.png')
    .then(() => {
        console.log('High-resolution icon created: icon.png (256x256)');
    })
    .catch(err => {
        console.error('Error creating icon:', err);
        process.exit(1);
    });
