const fs = require("fs");
const os = require("os");
const axios = require('axios');

function findImages() {
    let images = [];
    for (const image of fs.readdirSync("./images", { withFileTypes: true })) {
        if (image.isDirectory()) {
            for (const imageVersion of fs.readdirSync("./images/" + image.name, { withFileTypes: true })) {
                if (imageVersion.isDirectory()) {
                    images.push(image.name + "/" + imageVersion.name)
                }
            }
        }
    }
    return images;
}


async function upload() {
    if (!fs.existsSync("./temp")) {
        return console.log("No images to upload");
    }
    let images = findImages();

    const builderConfig = require("./config.json")
    let uploadableImages = fs.readdirSync("./temp");
    const sysarch = os.arch()
    await Promise.all(images.map(async (image) => {
        const config = require(`./images/${image}/config.json`);
        var id = config.os.replace(' ', '-').replace('.', "") + "-" + config.release.replaceAll(' ', '-').replaceAll('.', "-")
        uploadableImages.forEach(async (image) => {
            if (image.startsWith(id)) {
                console.log("Found image " + image)

                if (builderConfig.server["do-upload"] = true) {
                    for (const server of builderConfig.server.servers) {
                        await new Promise((resolvee, rejecte) => {
                            const FormData = require('form-data')

                            const data = new FormData()
                            data.append('rootfs', fs.createReadStream('./temp/' + image + "/rootfs.tar.xz"))
                            data.append('incusmeta', fs.createReadStream('./temp/' + image + "/incus.tar.xz"))
                            data.append('aliases', config.aliases)
                            data.append('architecture', sysarch == "amd64" ? "amd64" : "aarch64")
                            data.append('os', config.os)
                            data.append('release', config.release)
                            data.append('releasetitle', config.release)
                            data.append('variant', config.variant)
                            data.append("properties", JSON.stringify(config.properties))
                            console.log('[Remote] [' + image + '] Uploading to ' + server.url)
                            axios.post(server.url + 'images', data, {
                                maxBodyLength: Infinity, headers: {
                                    authorization: "Bearer " + server.auth
                                }
                            }).then(data => {
                                //console.log(data.data)
                                console.log('[Remote] [' + image + '] Uploaded image to ' + server.url)

                                /*                                       function clean() {
                                                                          var directory = "./temp"
                                                                          fs.readdir(directory, (err, files) => {
                                                                              if (err) throw err;
          
                                                                              for (const file of files) {
                                                                                  fs.unlink(path.join(directory, file), (err) => {
                                                                                      if (err) throw err;
                                                                                  });
                                                                              }
                                                                          });
                                                                      }
                                                                      clean()
                                                                      console.log('[FS] Done cleaning temp directory') */
                                resolvee()
                            }).catch((error) => {
                                console.log(error)
                                new Error("Failed to upload image " + image + " to " + server.url)
                                process.exit(1)
                                resolvee()
                            })
                        })
                    }
                }
            }
        })
    }));


}

upload();