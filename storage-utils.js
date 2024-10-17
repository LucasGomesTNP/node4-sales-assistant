const fs = require("fs");
const path = require("path");
function readProgramStorage(){
    let data = fs.readFileSync(path.join(__dirname, './storage.json'), {encoding: 'utf-8'});
    return JSON.parse(data);
}

function writeToProgramStorage(data){
    let dataString = '';
    if (typeof data === 'object') {
        dataString = JSON.stringify(data, 2, 2);
    } else {
        dataString = data;
    }
    return fs.writeFileSync(path.join(__dirname, './storage.json'), dataString);
}

function invertKeyAndValue(hashMap){
    let newObj = {};
    for(let key of Object.keys(hashMap)) {
        newObj[hashMap[key]] = key;
    }
    return newObj;

}

function getHashMapValues(hashMap){
    let arr = [];
    for(let key of Object.keys(hashMap)) {
        arr.push(hashMap[key]);
    }
    return arr;
}

/**
 * 
 * @param {*} mutationFunction Function that holds the variable `data` where you can mutate it and any change will be saved to the storage.
 */
function writeToProgramStorageFn(mutationFunction) {
    let data = readProgramStorage();
    mutationFunction(data);
    writeToProgramStorage(data);
    return data;
}

module.exports = {
    readProgramStorage,
    writeToProgramStorage,
    writeToProgramStorageFn,
    invertKeyAndValue,
    getHashMapValues,
}