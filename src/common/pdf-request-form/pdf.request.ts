import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as Handlebars from 'handlebars';
import * as path from 'path';
import * as PDFDocument from 'pdfkit';
import * as puppeteer from 'puppeteer';
@Injectable()
export class PdfService {
  constructor() { }

  async generatePdf(data: any, outputPath: string): Promise<void> {
    const doc = new PDFDocument();
    const templatePath = path.resolve(__dirname, '../../../views', 'index.hbs');
    const templateHtml = fs.readFileSync(templatePath, 'utf8');
    const template = Handlebars.compile(templateHtml);
    // const page = await browser.newPage();
    const html = template(data);
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setContent(html);
    await page.pdf({ path: outputPath }); 
    await browser.close();

    // if (!fs.existsSync(outputDir)) {
    //   fs.mkdirSync(outputDir, { recursive: true });
    // }

    // return new Promise((resolve, reject) => {
    //   const stream = fs.createWriteStream(outputPath);
    //   doc.pipe(stream);
    //   doc.text(html);
    //   doc.end();
    //   stream.on('finish', () => resolve());
    //   stream.on('error', (err) => reject(err));
    // });
  }
}