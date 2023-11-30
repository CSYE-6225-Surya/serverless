import axios from 'axios';
import { Storage } from '@google-cloud/storage';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { v4 as uuidv4 } from 'uuid';
import AdmZip from 'adm-zip';
const API_KEY = process.env.MAILGUN_API_KEY;
const DOMAIN = process.env.MAILGUN_DOMAIN;
const mailgun = new Mailgun(formData);
const client = mailgun.client({ username: 'api', key: API_KEY });
import atob from 'atob';
import AWS from "aws-sdk";
AWS.config.update({ region: process.env.AWS_REGION_DETAILS });
const docClient = new AWS.DynamoDB.DocumentClient();

const storage = new Storage({ credentials: JSON.parse(atob(process.env.GOOGLE_CREDENTIALS)) });
const bucketName = process.env.BUCKET_NAME;

export const handler = async (event, context) => {
    try {
        console.log(process.env.MAILGUN_API_KEY);
        console.log(process.env.MAILGUN_DOMAIN);
        const snsMessage = JSON.parse(event.Records[0].Sns.Message);
        const { id, assignmentId, url, email, count } = snsMessage;

        // Download the ZIP file from the submission URL

        console.log("SNS Message: " + snsMessage);
        const validateUrl = await validateZipFileUrl(url);
        if (!validateUrl) {
            const sender_email = process.env.SENDER_EMAIL;
            const receiver_email = email;
            const email_subject = 'Regarding your Assignment Submission';
            const email_body = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                /* Add your styles here */
            </style>
            </head>
            <body>
            <p><strong>Dear Student,</strong></p>

            <p><strong>Here are your submission details:</strong></p>
            <ul>
                <li><strong>Submission URL:</strong> ${url}</li>
                <li><strong>Submission File Name:</strong> null</li>
                <li><strong>Submission Count:</strong> ${count}</li>
                <li><strong>Status of the download:</strong>File cannot be downloaded due to invalid URL which is not pointing to zip downloadable file.</li>
            </ul>

            <p style="text-align: center;">This mail is intended to be received for ${email}.</p>
            </body>
            </html>
            `;
            const mailResponse = await sendMail(sender_email, receiver_email, email_subject, email_body, url, id, count);
            console.log(mailResponse);
            console.log("After calling mailgun");
            const dynamoDBResponse = await updateDynamoDB(receiver_email, url, count, id, "");
            console.log(dynamoDBResponse);
            console.log("after dynamodb put function");
            return;
        }
        const zipFileBuffer = await downloadZipFile(url);
        const fileName = `submissions/id/${id}/assignment/id/${assignmentId}/submission/count/${count}/email/${email}.zip`;
        console.log("After Zip File Validation, file name: " + fileName);
        // Upload the ZIP file to Google Cloud Storage
        await storage.bucket(bucketName).file(fileName).save(zipFileBuffer);
        console.log("After GCP Storage Call");

        console.log('ZIP file uploaded to Google Cloud Storage.');

        const sender_email = process.env.SENDER_EMAIL;
        const receiver_email = email;
        const email_subject = 'Regarding your Assignment Submission';
        // const email_body = `The submission url: ${url} downloaded and saved to the db with the file name: ${fileName}.`;
        const email_body = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                /* Add your styles here */
            </style>
            </head>
            <body>
            <p><strong>Dear Student,</strong></p>

            <p><strong>Here are your submission details:</strong></p>
            <ul>
                <li><strong>Submission URL:</strong> ${url}</li>
                <li><strong>Submission File Name:</strong> ${fileName}</li>
                <li><strong>Submission Count:</strong> ${count}</li>
                <li><strong>Status of the download:</strong>File downloaded successfully and saved to Google Cloud Storage.</li>
            </ul>

            <p style="text-align: center;">This mail is intended to be received for ${email}.</p>
            </body>
            </html>
            `;

        console.log("Before calling mailgun");

        const mailResponse = await sendMail(sender_email, receiver_email, email_subject, email_body, url, id, count);
        console.log(mailResponse);
        console.log("After calling mailgun");
        const dynamoDBResponse = await updateDynamoDB(receiver_email, url, count, id, fileName);
        console.log(dynamoDBResponse);
        console.log("after dynamodb put function");
    } catch (error) {
        console.error(`Error processing SNS message: ${error.message}`);
    }
};

const downloadZipFile = async (url) => {
    try {
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'arraybuffer',
        });

        return response.data;
    } catch (error) {
        throw new Error(`Error downloading ZIP file: ${error.message}`);
    }
};

const validateZipFileUrl = async (url) => {
    try {
        // Download the file
        const response = await axios.get(url, { responseType: 'arraybuffer' });

        // Check if the response appears to be a valid ZIP file
        const isValidZip = isZipFile(response.data);

        if (isValidZip) {
            console.log(`${url} is a valid URL pointing to a .zip file.`);
            return true;
        } else {
            console.error(`${url} does not point to a valid .zip file.`);
            return false;
        }
    } catch (error) {
        console.error(`Error validating URL: ${error.message}`);
        return false;
    }
};

const isZipFile = (buffer) => {
    try {
        // Attempt to create an AdmZip instance with the buffer
        const zip = new AdmZip(buffer);
        return true;
    } catch (error) {
        // If an error occurs, it's not a valid ZIP file
        return false;
    }
};

const updateDynamoDB = (email, submissionUrl, submissionCount, submissionId, fileName) => {
    const { DYNAMODB_TABLE_NAME } = process.env;
    console.log("In dynamodb function");
    const params = {
        TableName: DYNAMODB_TABLE_NAME,
        Item: {
            id: uuidv4(),
            email,
            submissionCount,
            submissionUrl,
            submissionId,
            fileName
        }
    };
    console.log("before dynamodb put function");
    return docClient.put(params).promise();
}

const sendMail = (sender_email, receiver_email, email_subject, email_body, url, id, count) => {
    console.log("In sendMail function");
    const data = {
        from: sender_email,
        to: receiver_email,
        subject: email_subject,
        html: email_body
    };
    console.log("before send call");
    return client.messages.create(DOMAIN, data);
};
