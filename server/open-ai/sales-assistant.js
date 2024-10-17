const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const storageUtils = require("../../storage-utils.js");

/*
const __dirname = dirname(fileURLToPath(import.meta.url));


dotenv.config({path: join(__dirname, '../../.env')});
*/

const openai = new OpenAI();



const salesAssistantName = "Node4 Sales Assistant";
exports.salesAssistantName = salesAssistantName;

async function getOpenAiSalesAssistant(){
    const salesAssistantId = storageUtils.readProgramStorage().assistantId;

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
        storageUtils.writeToProgramStorageFn((data) => {
            data.assistantId = assistant.id;
        });

        

    }

    console.log(`Using assistant ${assistant.id}`);


    return assistant;

}
exports.getOpenAiSalesAssistant = getOpenAiSalesAssistant;

async function getVectorStore(assistant) {
    const fileStreams = [path.join(__dirname, "../../CaseStudies.md")].map((path) =>
        fs.createReadStream(path),
    );

    let vectorStore = null;
    const vectorStoreName = "sales-assistant-vector";
    const vectorStoreId = storageUtils.readProgramStorage().vectorStoreId;
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
            throw e;
        }
    }

    if (!vectorStore || vectorStore.status === 'expired') {
        console.log(`Vector Store with id ${vectorStoreId} not found or expired. Creating it with the name ${vectorStoreName}`);
        // Create a vector store including our two files.
        vectorStore = await openai.beta.vectorStores.create({
            name: vectorStoreName,
            expires_after: {
                anchor: "last_active_at",
                days: 1
            }
        });
        console.log(`Vector Store "${vectorStoreName}" ID=${vectorStore.id} has been created`);
        storageUtils.writeToProgramStorageFn((data) => {
            data.vectorStoreId = vectorStore.id;
        })
    }
    console.log(`Using Vector Store "${vectorStoreName}" ID=${vectorStore.id}`);
    console.log("vectorStore", vectorStore);


    let assistantKnowledgeBaseFilesDir = path.join(__dirname, '../assistant-knowledge-files');
    let files = fs.readdirSync(assistantKnowledgeBaseFilesDir);

    const newKnowledgeBaseFilesNamesToIds = storageUtils.readProgramStorage().knowledgeBaseFilesNamesToIds;

    for(let fileName of files) {
        let filePath = path.join(assistantKnowledgeBaseFilesDir, fileName);
        if (fs.statSync(filePath).isDirectory() === false) {
            if (typeof newKnowledgeBaseFilesNamesToIds[fileName] === 'undefined' || !(newKnowledgeBaseFilesNamesToIds[fileName])) {
                const fileUploaded = await openai.files.create({
                    file: fs.createReadStream(filePath),
                    purpose: "assistants",
                });

                let vectorStoreFile = await openai.beta.vectorStores.files.create(vectorStore.id, {
                    file_id: fileUploaded.id,
                });

                console.log("vectorStoreFile", vectorStoreFile);

                newKnowledgeBaseFilesNamesToIds[fileName] = fileUploaded.id;
            } else {
                
            }
        }
    }

    

    storageUtils.writeToProgramStorageFn((data) => {
        data.knowledgeBaseFilesNamesToIds = newKnowledgeBaseFilesNamesToIds;
    });

    let openAiFileIds = storageUtils.getHashMapValues(newKnowledgeBaseFilesNamesToIds);

    const myVectorStoreFileBatch = await openai.beta.vectorStores.fileBatches.create(
        vectorStore.id,
        {
            file_ids: openAiFileIds
        }
    );
    console.log("myVectorStoreFileBatch", myVectorStoreFileBatch);

    await openai.beta.assistants.update(assistant.id, {
        tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
    });

    return {vectorStore};
}
exports.getVectorStore = getVectorStore;

async function createThread(userMessage){

    let messageOptions = undefined;
    if (userMessage) {
        messageOptions = [
            {
                role: "user",
                content: userMessage,
            },
        ];
    }
    const thread = await openai.beta.threads.create({
        messages: messageOptions,
    });
    return thread;
}
exports.createThread = createThread;

async function getThread(threadId){
    const thread = await openai.beta.threads.retrieve(threadId);
    return thread;
}
exports.getThread = getThread;

function runThreadWithStream(threadId, assistantId, options){
    return new Promise((resolve, reject) => {
        let sourceIndex = 0;
        let allCitations = [];
        let displayCitations = (options && typeof options.displayCitations === 'boolean') ? options.displayCitations : false;
        let onTextReceived = (options && options.onTextReceived) ? options.onTextReceived : function(text){return;};
        let onTextFinished = (options && options.onTextFinished) ? options.onTextFinished : function(text){return;};
        let fileAnnotationsIdDict = {};

        const stream = openai.beta.threads.runs
        .stream(threadId, {
            assistant_id: assistantId,
        })
        .on("textCreated", () => {/*console.log("assistant >")*/})
        .on("toolCallCreated", (event) => {console.log("assistant " + event.type)})
        .on('textDelta', async (textDelta, snapshot) => {
            let text = textDelta.value;
            const { annotations } = textDelta;

            if (annotations) {
                for (let annotation of annotations) {

                    if (displayCitations) {
                        console.log('annotation', {annotation, text});
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
                    } else {
                        text = textDelta.value.replace(annotation.text, "");
                    }
                }
            }


            //process.stdout.write(text);
            onTextReceived(text);
        })
        .on("messageDone", async (event) => {
            if (event.content[0].type === "text") {
                
                if (displayCitations) {
                    let citationsFooter = "\n\n" + allCitations.join("\n");
                    let citationsFooterExtraLine = "\n\n" + allCitations.join("\n\n");
                    process.stdout.write(citationsFooter);
                    onTextReceived(citationsFooterExtraLine);
                }
                
                const { text } = event.content[0];
                const { annotations } = text;
                
                const citations = [];

                let index = 0;
                for (let annotation of annotations) {

                    if (displayCitations) {
                        text.value = text.value.replace(annotation.text, "[" + index + "]");
                        const { file_citation } = annotation;

                        
                        if (file_citation) {

                            let fileName = fileAnnotationsIdDict[file_citation.file_id];
                            if (!fileName) {
                                try {
                                    const citedFile = await openai.files.retrieve(file_citation.file_id);
                                    fileName = citedFile.fileName;
                                    fileAnnotationsIdDict[file_citation.file_id] = fileName;    
                                } catch (e) {
                                    reject(e);
                                }
                                
                            }

                            citations.push("[" + index + "]" + fileName);
                        }
                        index++;
                    } else {
                        text.value = text.value.replace(annotation.text, "");
                    }
                }

                let allText = text.value;
                if (displayCitations) {
                    allText += "\n" + citations.join("\n");
                }

                onTextFinished(allText);
                resolve(allText);

                

                
            }
        });
    })
    
}
exports.runThreadWithStream = runThreadWithStream;


async function initateConversationWithOpenAiAssistant(query){

    let assistant = await getOpenAiSalesAssistant();
    await getVectorStore(assistant);
    let thread = await createThread(query);

    return thread;

    
}
exports.initateConversationWithOpenAiAssistant = initateConversationWithOpenAiAssistant;

async function sendMessageToThread(threadId, userMessage, options) {
    const threadMessages = await openai.beta.threads.messages.create(
        threadId,
        { role: "user", content: userMessage }
    );

    let displayCitations = (options && typeof options.displayCitations === 'boolean') ? options.displayCitations : false;
    let onTextReceived = (options && options.onTextReceived) ? options.onTextReceived : function(text){return;};
    let onTextFinished = (options && options.onTextFinished) ? options.onTextFinished : function(text){return;};

    let assistantId = storageUtils.readProgramStorage().assistantId;

    return await runThreadWithStream(threadId, assistantId, {
      displayCitations,
      onTextReceived,
      onTextFinished  
    })
    
    
}
exports.sendMessageToThread = sendMessageToThread;
