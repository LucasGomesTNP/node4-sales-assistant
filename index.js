require("dotenv").config();
const OpenAI = require("openai");
const fs = require("fs");

const openai = new OpenAI();


function readProgramStorage(){
    let data = fs.readFileSync('./storage.json', {encoding: 'utf-8'});
    return JSON.parse(data);
}

function writeToProgramStorage(data){
    let dataString = '';
    if (typeof data === 'object') {
        dataString = JSON.stringify(data, 2, 2);
    } else {
        dataString = data;
    }
    return fs.writeFileSync('./storage.json', dataString);
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


async function main(){

    const salesAssistantName = "Node4 Sales Assistant";
    const salesAssistantId = readProgramStorage().assistantId;


    let assistant = null;

    // https://platform.openai.com/docs/assistants/tools/file-search?lang=node.js

    console.log("Trying to find assistant", salesAssistantId);
    try {
        assistant = await openai.beta.assistants.retrieve(salesAssistantId);
    } catch (error) {
        if (error.status !== 404) { 
            console.error(error);
            return;
        }
    }

    if (!assistant) {
        console.log("Could not find assistant", salesAssistantId, `Creating one with the name "${salesAssistantName}".`);
        assistant = await openai.beta.assistants.create({
            name: salesAssistantName,
            instructions: "You are an expert Sales Assistant of the company Node4. Use you knowledge base to propose a solution that includes the services/technologies that Node4 provides.",
            model: "gpt-4o-mini",
            tools: [{ type: "file_search" }],
        });

        console.log(`Created assistant ${assistant.id}`);
        writeToProgramStorageFn((data) => {
            data.assistantId = assistant.id;
        });
    }

    console.log(`Using assistant ${assistant.id}`);
    

    console.log("assistant", assistant);

    const fileStreams = ["./CaseStudies.md"].map((path) =>
        fs.createReadStream(path),
    );

    let vectorStore = null;
    const vectorStoreName = "sales-assistant-vector";
    const vectorStoreId = readProgramStorage().vectorStoreId;
    try {
        if (!vectorStoreId) {
            let error = new Error("Empty vectorStoreId in storage");
            error.status = 404;
            throw error;
        }
        console.log(`Trying to find Vector Store id=${vectorStoreId}`);

        vectorStore = await openai.beta.vectorStores.retrieve(vectorStoreId);

        console.log(`Found Vector Store with id=${vectorStore.id}`);
        console.log("vectorStore retrieve", vectorStore);

        
    } catch (e) {
        if (e.status !== 404) { 
            console.error(e);
            return;
        }
    }

    if (!vectorStore) {
        console.log(`Vector Store with id ${vectorStoreId} not found. Creating it with the name ${vectorStoreName}`);
        // Create a vector store including our two files.
        vectorStore = await openai.beta.vectorStores.create({
            name: vectorStoreName,
            expires_after: {
                anchor: "last_active_at",
                days: 1
            }
        });
        console.log(`Vector Store "${vectorStoreName}" ID=${vectorStore.id} has been created`);
        writeToProgramStorageFn((data) => {
            data.vectorStoreId = vectorStoreId;
        })
    }
    console.log(`Using Vector Store "${vectorStoreName}" ID=${vectorStore.id}`);
    console.log("vectorStore", vectorStore);

    const caseStudiesFileId = readProgramStorage().caseStudiesFileId;
    let vectorStoreFile = null;
    try {
        if (caseStudiesFileId.trim() === '') {
            let error = new Error('caseStudiesFileId not populated.');
            error.status = 404;
            throw error;
        }
        console.log(`Trying to find Vector File ${caseStudiesFileId} of Vector Store ${vectorStore.id}`);
        vectorStoreFile = await openai.beta.vectorStores.files.retrieve(
            vectorStore.id,
            caseStudiesFileId,
        );
        
    } catch (e) {
        if (e.status !== 404) {
            console.error(e);
            return;
        }
    }

    if (!vectorStoreFile) {

        
        
        console.log(`Vector File ${caseStudiesFileId} of Vector Store ${vectorStore.id} not found. Creating it...`);

        const file = await openai.files.create({
            file: fileStreams[0],
            purpose: "assistants",
        });

        console.log("File", file);

        let savedRecord = writeToProgramStorageFn((data) => {
            data.caseStudiesFileId = file.id;
        });

        vectorStoreFile = await openai.beta.vectorStores.files.create(vectorStore.id, {
            file_id: file.id,
        });
        console.log(vectorStoreFile);
        console.log(`Vector File ${savedRecord.caseStudiesFileId} of Vector Store ${vectorStore.id} has been created`);
    }

    console.log(`Using Vector file ${vectorStoreFile.id}`, vectorStoreFile);

    await openai.beta.assistants.update(assistant.id, {
    tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
    });

    const inputQuery = fs.readFileSync("./input.txt", "utf-8");

    const thread = await openai.beta.threads.create({
        messages: [
            {
            role: "user",
            content: inputQuery,
            },
        ],
    });

    console.log("initiating stream");

    let sourceIndex = 0;
    let allCitations = [];
    let displayCitations = true;
    let fileAnnotationsIdDict = {};

    const stream = openai.beta.threads.runs
    .stream(thread.id, {
        assistant_id: assistant.id,
    })
    .on("textCreated", () => console.log("assistant >"))
    .on("toolCallCreated", (event) => console.log("assistant " + event.type))
    .on('textDelta', async (textDelta, snapshot) => {
        let text = textDelta.value;
        const { annotations } = textDelta;

        if (annotations && displayCitations) {
            for (let annotation of annotations) {
                text = textDelta.value.replace(annotation.text, "[" + sourceIndex + "]");
                const { file_citation } = annotation;
                if (file_citation) {
                    let fileName = fileAnnotationsIdDict[file_citation.file_id];
                    if (!fileName) {
                        const citedFile = await openai.files.retrieve(file_citation.file_id);
                        fileName = citedFile.filename;
                        fileAnnotationsIdDict[file_citation.file_id] = fileName;
                    }
                    
                    allCitations.push("[" + sourceIndex + "]" + fileName);
                    //console.log("allCitations", JSON.stringify(allCitations));
                }
                sourceIndex++;
            }
        }


        process.stdout.write(text);
    })
    .on("messageDelta", async (event) => {
        //console.log("messageDelta event", event);
        //console.log("event Message Delta", JSON.stringify(event));
        return;
        if (event.content[0].type === "text") {
            const { text } = event.content[0];
            const { annotations } = text;
            
            if (annotations && displayCitations) {
                for (let annotation of annotations) {
                    text.value = text.value.replace(annotation.text, "[" + sourceIndex + "]");
                    const { file_citation } = annotation;
                    if (file_citation) {
                        
                    const citedFile = await openai.files.retrieve(file_citation.file_id);
                    allCitations.push("[" + sourceIndex + "]" + citedFile.filename);
                    }
                    sourceIndex++;
                }
            }

            //console.log(text.value);
            //console.log(citations.join("\n"));
            if (annotations && displayCitations) {
                process.stdout.write(text.value);
            }

            if (!annotations) {
                process.stdout.write(text.value);
            }
            

            

            
        }
    })
    .on("messageDone", async (event) => {
        if (event.content[0].type === "text") {
            
            if (displayCitations) {
                console.log(allCitations.join("\n"));
            }
            
            const { text } = event.content[0];
            const { annotations } = text;
            
            const citations = [];

            let index = 0;
            for (let annotation of annotations) {
                text.value = text.value.replace(annotation.text, "[" + index + "]");
                const { file_citation } = annotation;

                
                if (file_citation) {

                    let fileName = fileAnnotationsIdDict[file_citation.file_id];
                    if (!fileName) {
                        const citedFile = await openai.files.retrieve(file_citation.file_id);
                        fileName = citedFile.fileName;
                        fileAnnotationsIdDict[file_citation.file_id] = fileName;
                    }

                    citations.push("[" + index + "]" + fileName);
                }
                index++;
            }


            let allText = text.value + citations.join("\n");

            //console.log(text.value);
            //console.log(citations.join("\n"));

            console.log(allText);

            fs.writeFileSync("output.md", allText);

            

            
        }
    });
    /*
    for await (const event of stream) {
        console.log(event);
    }
    */



}

main()
.then(() => {
    console.log("supposedlu done");
})
.catch((err) => {
    console.error(err);
})