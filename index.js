const axios = require('axios').default
const ws = require('ws')
const fs = require('fs')
const path = require("path");
const os = require("os");
/**
 * @type {import('axios').Axios & {ws: (url) => import('ws').WebSocket}}
 */
const client = new axios.Axios({
    socketPath: "/var/lib/incus/unix.socket",
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 9999999
})
client.ws = (url) => {
    return new ws.WebSocket("ws+unix:///var/lib/incus/unix.socket:" + url)
}
function handleError(err) {
    console.log(err)
    process.exit(1)
}

const { spawn } = require('child_process');
const downloadBase = require('./downloadBase');
function untar(path, out) {
    return new Promise((resolve, reject) => {
        // fs.mkdirSync(out)
        var tar = spawn('sh', ['-c', 'pv ' + path + ' | tar -C ' + out + " -xz"],
            {
                env: {
                    "XZ_DEFAULTS": "-T 8"
                }
            })
        tar.stderr.on('data', (d) => {
            console.log(d.toString())
        })
        tar.stdout.on('data', (d) => {
            console.log(d.toString())
        })
        tar.on('close', (code) => {
            //console.log(code)
            if (code == 0) {
                resolve()
            } else {
                reject()
            }

        })
    })
}
function tarfiles(cwd, path, out) {
    return new Promise((resolve, reject) => {
        // fs.mkdirSync(out)
        var tar = spawn('sh', ['-c', `tar -cJf ${out} ${path}`], {
            env: {
                "XZ_DEFAULTS": "-T 8"
            },
            cwd
        })
        tar.stderr.on('data', (d) => {
            console.log(d.toString())
        })
        tar.stdout.on('data', (d) => {
            console.log(d.toString())
        })
        tar.on('close', (code) => {
            //console.log(code)
            if (code == 0) {
                resolve()
            } else {
                reject()
            }

        })
    })
}
function doExport(id) {
    return new Promise(async (resolve, reject) => {
        try {
            var export_data = JSON.parse((await client.post('/1.0/instances/' + id + "/backups", JSON.stringify({
                "compression_algorithm": "gzip",
                "container_only": false,
                "instance_only": false,
                "name": id + "-export",
                "optimized_storage": false,
            }))).data)
            await client.get(export_data.operation + "/wait?timeout=99999")
            client.get('/1.0/instances/' + id + "/backups/" + id + "-export" + "/export", { responseType: "stream" }).then((s) => {
                fs.mkdirSync('./temp/' + id)
                var writer = fs.createWriteStream('./temp/' + id + "/backup.tar.xz")
                s.data.pipe(writer)
                let error = null;
                writer.on('error', err => {
                    error = err;
                    writer.close();
                    reject(err);
                });
                writer.on('close', () => {
                    if (!error) {
                        resolve(true);
                    }
                    //no need to call the reject here, as it will have been called in the
                    //'error' stream;
                });
            }).catch(handleError)
        } catch (error) {
            console.log(error)
        }

    })
}
function makeid(length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() *
            charactersLength));
    }
    return result;
}
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

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

async function main() {
    await new Promise(async (p, q) => {
        var jobs = []
        if (!fs.existsSync('./temp')) fs.mkdirSync('./temp');
        for (const image of findImages()) {
            jobs.push(new Promise((resolve, reject) => {
                const config = require('./images/' + image + '/config.json')
                if (!config.os || !config.architectures || !config.release || !config.variant || !config.aliases || !config.imageserver || !config.base || !config.commands || !config.files) handleError(new Error("Config file of " + config + " is missing required keys."))
                var sysarch = os.arch()
                if (sysarch == "x64") sysarch = "amd64";
                if (!config.architectures.includes(sysarch)) handleError(new Error("System architecture " + sysarch + " is not supported by " + image + "."))
                
                var d = new Date()
                var zero = d.getMonth() < 10 ? "0" : ""
                var zeroday = d.getDate() < 10 ? "0" : ""
                var zerohours = d.getHours() < 10 ? "0" : ""
                var zerominutes = d.getMinutes() < 10 ? "0" : ""
                var zeroseconds = d.getSeconds() < 10 ? "0" : ""
                var date = `${d.getFullYear()}-${zero + d.getMonth() + 1}-${zeroday + d.getDate()}-${zerohours + d.getHours()}${zerominutes + d.getMinutes()}${zeroseconds + d.getSeconds()}`
                var id = config.os.replace(' ', '-').replace('.', "") + "-" + config.release + "-" + date
                console.log("[Incus] [" + id + "] Initializing instance...")
                client.post('/1.0/instances', JSON.stringify({
                    name: id,
                    "profiles": [
                        require('./config.json').default_profile
                    ],
                    "architecture": sysarch != "arm64" ? "x86_64" : "aarch64",
                    source: {
                        "protocol": "simplestreams",
                        "server": config.imageserver,
                        "alias": config.base,
                        "type": "image"
                    }
                })).then(({ data }) => {
                    data = JSON.parse(data)
                    //console.log(data)
                    //console.log(data.operation + "/wait?timeout=9999")
                    client.get(data.operation + "/wait?timeout=9999").then(async (create_operation) => {
                        //console.log(create_operation.data)
                        await sleep(1000)
                        // console.log('/1.0/instances/' + id + "/state")
                        client.put('/1.0/instances/' + id + "/state", JSON.stringify({
                            "action": "start",
                            "force": false,
                            "stateful": false,
                            "timeout": 30
                        })).then((start_data) => {

                            //console.log(start_data.data)
                            //console.log(JSON.parse(start_data.data).operation + "/wait?timeout=9999")
                            client.get(JSON.parse(start_data.data).operation + "/wait?timeout=9999").then(async (start_operation) => {
                                //console.log(start_operation.data)
                                for (const file of config.files) {
                                    try {
                                        await new Promise((re, rej) => {
                                            try {
                                                console.log('[Upload] [' + id + '] Uploading file ' + file.split(':')[0])
                                                const https = require('http')
                                                var opts = {
                                                    rejectUnauthorized: false,
                                                    method: "POST",
                                                    socketPath: "/var/lib/incus/unix.socket",
                                                    path: encodeURI("/1.0/instances/" + id + "/files?path=" + file.split(':')[1]),
                                                    headers: {
                                                        "Content-Type": `application/octet-stream`
                                                    },
                                                }
                                                var request = https.request(opts, function (response) {
                                                    response.on('error', (err) => {
                                                        rej(err)
                                                    })
                                                });
                                                console.log(fs.existsSync(`./images/${image}/files/${file.split(':')[0]}`))
                                                var ReadStream = fs.createReadStream(`./images/${image}/files/${file.split(':')[0]}`)
                                                var bytes = 0
                                                var size = fs.lstatSync(ReadStream.path).size;
                                                ReadStream.on('data', (chunk) => {
                                                    bytes += chunk.length;
                                                    var percent = ((bytes) * 100) / size
                                                    var data = {
                                                        bytes: {
                                                            sent: bytes,
                                                            total: size
                                                        },
                                                        percent: percent
                                                    }
                                                    console.log('[Upload] [' + id + '] ' + percent + "%")
                                                    if (data.percent == 100) {
                                                        console.log('[Upload] [' + id + ']  Finished')
                                                        re()
                                                    }
                                                }).pipe(request)

                                            } catch (error) {
                                                console.log(error)
                                            }

                                        }).catch(handleError)
                                    } catch (error) {
                                        console.log(error)
                                    }

                                }
                                console.log("[Incus] [" + id + "] Done initializing instance")
                                for (const command of config.commands) {
                                    await new Promise(async (re, rej) => {
                                        console.log('[Exec] [' + id + '] Running command ' + command)
                                        try {
                                            var exec_data = JSON.parse((await client.post('/1.0/instances/' + id + "/exec", JSON.stringify({
                                                command: ["bash", "-c", command],
                                                interactive: true,
                                                "wait-for-websocket": true
                                            }))).data)
                                        } catch (error) {
                                            handleError(error)
                                        }
                                        //onsole.log(exec_data.metadata.metadata.fds)
                                        //console.log({
                                        //    exec: exec_data.operation + "/websocket?secret=" + exec_data.metadata.metadata.fds['0'],
                                        //   control: exec_data.operation + "/websocket?secret=" + exec_data.metadata.metadata.fds['control']
                                        //})
                                        var execws = client.ws(exec_data.operation + "/websocket?secret=" + exec_data.metadata.metadata.fds['0'])
                                        var controlws = client.ws(exec_data.operation + "/websocket?secret=" + exec_data.metadata.metadata.fds['control'])
                                        execws.on('message', (data) => {
                                            if (data.toString() == "") {
                                                re()
                                                execws.close()
                                                controlws.close()
                                            }
                                            if (data.toString() == "\n") return;
                                            console.log(data.toString().replace('\r\n', "").replace('\n', "").replace('\r', ""))
                                        })
                                    }).catch(handleError)

                                }

                                try {
                                    console.log('[Export] [' + id + '] Exporting backup')
                                    await doExport(id)
                                    console.log('[Export] [' + id + '] Extracting backup')
                                    fs.mkdirSync('./temp/' + id + "/backup")
                                    await untar('./temp/' + id + "/backup.tar.xz", './temp/' + id + "/backup")
                                    console.log('[Export] [' + id + '] Moving directories')
                                    //fs.mkdirSync('./temp/' + id + "/backup/rootfs")
                                    //fs.mkdirSync('./temp/' + id + "/backup/meta")
                                    var fsext = require('fs-extra');
                                    fsext.moveSync('./temp/' + id + "/backup/backup/container/rootfs", './temp/' + id + "/backup/rootfs")
                                    var rootfsDir = './temp/' + id + "/backup/rootfs"
                                    fsext.moveSync('./temp/' + id + "/backup/backup/container", './temp/' + id + "/backup/meta")
                                    var metaDir = './temp/' + id + "/backup/meta"
                                    console.log('[Editor] [' + id + '] Edit Metadata')
                                    const yaml = require('yaml')
                                    const yamldata = fs.readFileSync(metaDir + "/metadata.yaml").toString()
                                    var yamlparsed = yaml.parse(yamldata)

                                    console.log('[Editor] [' + id + '] Add Templates')
                                    let tempConfig = Object.keys(config.templates);
                                    for (let i = 0; i < tempConfig.length; i++) {
                                        const temp = tempConfig[i];
                                        console.log('[Editor] [' + id + '] Adding template ' + temp + ' to config');
                                        const tempData = config.templates[temp];
                                        yamlparsed.templates[temp] = tempData;
                                    }
                                    console.log('[Editor] [' + id + '] Edit Properties')
                                    yamlparsed.architecture = sysarch == "amd64" ? "amd64" : "aarch64"
                                    yamlparsed.properties.architecture = sysarch == "amd64" ? "amd64" : "aarch64"
                                    yamlparsed.properties.name = config.os
                                    yamlparsed.properties.os = config.os
                                    yamlparsed.properties.release = config.release
                                    yamlparsed.properties.release = config.release
                                    let key = await downloadBase(config.imageserver, config.base);
                                    let baseYaml = fs.readFileSync(`./temp/${key}/metadata.yaml`).toString();
                                    let baseParsed = yaml.parse(baseYaml);
                                    let baseTemplates = Object.keys(baseParsed.templates);
                                    for (let i = 0; i < baseTemplates.length; i++) {
                                        const temp = baseTemplates[i];
                                        console.log('[Editor] [' + id + '] Adding template ' + temp + ' to config');
                                        const tempData = baseParsed.templates[temp];
                                        yamlparsed.templates[temp] = tempData;
                                    }
                                    fs.writeFileSync(metaDir + "/metadata.yaml", yaml.stringify(yamlparsed))
                                    console.log('[Templating] [' + id + '] Adding templates')
                                    if (fs.existsSync(`./images/${image}/templates`)) {
                                    let templates = fs.readdirSync(`./images/${image}/templates`);
                                    for (const template of templates) {
                                        console.log('[Templating] [' + id + '] Adding template ' + template)
                                        fs.cpSync(`./images/${image}` +"/templates" + "/" + template, metaDir + "/templates" + "/" + template);
                                    }
                                    let baseTemplates = fs.readdirSync(`./temp/${key}/templates`);
                                    for (const template of baseTemplates) {
                                        console.log('[Templating] [' + id + '] Adding template ' + template)
                                        fs.cpSync(`./temp/${key}/templates` + "/" + template, metaDir + "/templates" + "/" + template);
                                    }
                                    }
                                    console.log('[Editor] [' + id + '] Done editing metadata')
                                    console.log('[Archive] [' + id + '] Compressing files')
                                    await tarfiles(metaDir, ".", "../../incus.tar.xz")
                                    await tarfiles(rootfsDir, ".", "../../rootfs.tar.xz")
                                    fs.rmSync('./temp/' + id + "/backup", { recursive: true, force: true })
                                    console.log('[Incus] [' + id + '] Remove build container')
                                    client.put('/1.0/instances/' + id + "/state", JSON.stringify({
                                        "action": "stop",
                                        "force": true,
                                        "stateful": false,
                                        "timeout": 30
                                    })).then((start_data2) => {

                                        //console.log(start_data.data)
                                        //console.log(JSON.parse(start_data.data).operation + "/wait?timeout=9999")
                                        client.get(JSON.parse(start_data2.data).operation + "/wait?timeout=9999").then(async (start_operation2) => {
                                            await client.delete('/1.0/instances/' + id)
                                            console.log('[Incus] [' + id + '] Removed build container')

                                            if (require('./config.json').server['do-upload'] == true) {
                                                console.log('[Remote] [' + id + '] Uploading is enabled')
                                                var e = require('./config.json')
                                                for (const server of e.server.servers) {
                                                    await new Promise((resolvee, rejecte) => {
                                                        const FormData = require('form-data')

                                                        const data = new FormData()
                                                        data.append('rootfs', fs.createReadStream('./temp/' + id + "/rootfs.tar.xz"))
                                                        data.append('incusmeta', fs.createReadStream('./temp/' + id + "/incus.tar.xz"))
                                                        data.append('aliases', config.aliases)
                                                        data.append('architecture', sysarch == "amd64" ? "amd64" : "aarch64")
                                                        data.append('os', config.os)
                                                        data.append('release', config.release)
                                                        data.append('releasetitle', config.release)
                                                        data.append('variant', config.variant)
                                                        data.append("properties", JSON.stringify(config.properties))
                                                        console.log('[Remote] [' + id + '] Uploading to ' + server.url)
                                                        axios.post(server.url + 'images', data, {
                                                            maxBodyLength: Infinity, headers: {
                                                                authorization: "Bearer " + server.auth
                                                            }
                                                        }).then(data => {
                                                            //console.log(data.data)
                                                            console.log('[Remote] [' + id + '] Built and Uploaded image to ' + server.url)

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
                                                        }).catch(handleError)
                                                    })
                                                }




                                            } else {
                                                console.log('[Done] Built image ' + id)
                                            }


                                            resolve()
                                        }).catch(handleError)
                                    })

                                } catch (error) {
                                    handleError(error)
                                }

                            }).catch(handleError)
                        })

                    }).catch(handleError)
                }).catch(handleError)
            }))
        }
        await Promise.all(jobs)
        p()
    })
}
main().catch(console.log)

//what is the structure of config.json for the image builder, not for the images
/*
{
    
}
*/