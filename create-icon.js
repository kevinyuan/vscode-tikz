const sharp = require('sharp');
const fs = require('fs');

const svgBuffer = fs.readFileSync('icon.svg');

sharp(svgBuffer)
    .resize(128, 128)
    .png()
    .toFile('icon.png')
    .then(() => {
        console.log('Icon created: icon.png');
    })
    .catch(err => {
        console.error('Error creating icon:', err);
        process.exit(1);
    });
