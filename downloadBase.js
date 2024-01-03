const fs = require("fs")

async function downloadBase(imageServer, alias) {
    console.log(`Downloading base image for ${alias} from ${imageServer}`)
    const index = await fetch(`${imageServer}/streams/v1/index.json`).then(r => r.json());
    let images = await fetch(`${imageServer}/${index.index.images.path}`).then(r => r.json());
    let imageKey = Object.keys(images.products).find(k => images.products[k].aliases.includes(alias));
    let image = images.products[imageKey];

    let downloadPath = image.versions[Object.keys(image.versions).sort().pop()].items["incus.tar.xz"].path;
  //download the incus.tar.xz and write to `temp/${alias}/incus.tar.xz`
  if (!fs.existsSync(`./temp/${imageKey}`)) fs.mkdirSync(`./temp/${imageKey}`, { recursive: true });
    let incus = await fetch(`${imageServer}/${downloadPath}`).then(r => r.arrayBuffer());
    fs.writeFileSync(`./temp/${imageKey}/incus.tar.xz`, Buffer.from(incus));
    //extract incus.tar.xz to `temp/${alias}`
    console.log(`Extracting incus.tar.xz to temp/${imageKey}`)
    const { exec, execSync } = require("child_process");
    execSync(`tar -xJf temp/${imageKey}/incus.tar.xz -C temp/${imageKey}`);
    console.log("Base image downloaded and extracted")
    return imageKey;
}

module.exports = downloadBase;
