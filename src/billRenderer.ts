import * as restify from 'restify';
import * as request from 'request';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as format from 'string-template';
import billTypes from './billType';
import { Lang, ReqImgType } from './utility';
import * as puppeteer from 'puppeteer';
import * as util from './utility';

const D3Node = require('d3-node');
const svg2png = require('svg2png');
const { convert } = require('convert-svg-to-png');

export class BillRenderer {
  private readonly template: string;

  constructor () {
    this.template = fs.readFileSync('./assets/bill-card-template.svg').toString();
  }

  public async handleRequest(req: restify.Request, res: restify.Response) {
    let id: string = req.params.id;
    let lang: Lang = req.query.lang === 'en' ? 'en' : 'zh';
    let imgType: ReqImgType;
    if (id.toLowerCase().endsWith('.png')) {
      imgType = 'png';
    } else if (id.toLowerCase().endsWith('.svg')) {
      imgType = 'svg';
    }
    if (imgType) {
      try {
        let [bill, sponsorDisplay] = await this.fetchBill(id, lang);
        let [pill1, dx1] = await this.pill(bill.congressDisplay);
        let [pill2, dx2] = await this.pill(bill.billCodeDisplay, dx1 + 30);
        let [pill3, dx3] = await this.pill(bill.billTypeDisplay, dx1 + 30 + dx2 + 30);
        let card = format(this.template, {
          PILLS: `${pill1}${pill2}${pill3}`,
          BILL_CODE: bill.billCodeDisplay,
          BILL_TITLE: bill.title,
          SPONSOR: sponsorDisplay,
          INTRO_DATE: bill.introducedDateDisplay,
          COSPONSORS: bill.cosponsorIds.length,
          LAST_ACTION: bill.latestActionDisplay
        });
        await this.respondCard(card, res, imgType);
      } catch (e) {
        await this.respondCard(this.template, res, imgType);
      }
    } else {
      res.send(200, id);
      res.end();  
    }
  }
  
  private async respondCard(card: string, res: restify.Response, imgType: ReqImgType) {
    if (imgType === 'png') {
      const png = await convert(card, {puppeteer: {headless: true, args:['--no-sandbox']}});
      res.set('Content-Type', 'image/png');
      res.write(png, 'binary');
      res.end(null, 'binary');
      // svg2png(new Buffer(card), { width: 1200, height: 630 })
      // .then(buffer => {
      //   res.write(buffer,'binary');
      //   res.end(null, 'binary');
      // });
    } else {
      res.contentType = 'image/svg+xml';
      res.write(card);
      res.end();
    }
  }

  // return [memberJson, sponsorDisplay]
  private fetchBill(id: string, lang: Lang): Promise<[any, string]> {
    const url = `https://api.uswatch.tw/prod/v2?id=${id}&field=title&field=congress&field=billType&field=billNumber&field=introducedDate&field=sponsorIds&field=cosponsorIds&field=actions`;
    return new Promise((resolve, reject) => {
      request.get(url, (error, response, body) => {
        if (!error && response.statusCode === 200) {
          const json = JSON.parse(body)[0];
          console.log(JSON.stringify(json, null, 2));
          this.postGenerateFields(json, lang);
          return Promise.all([
            this.fetchMember(json.sponsorIds[0])
          ]).then(([member]) => {
            const sponsorDisplay = this.sponsorName(member, json, lang);
            resolve([json, sponsorDisplay]);
          });
        } else {
          reject(`can not connect url = ${url}. \nError = ${error} \nResponseCode = ${response && response.statusCode} Body = ${body}`);
        }
      });
    });
  }

  private fetchMember(id: string): Promise<any> {
    const url = `https://api.uswatch.tw/prod/v2?id=${id}&field=firstName&field=lastName&field=middleName&field=congressRoles`;
    return new Promise((resolve, reject) => {
      request.get(url, (error, response, body) => {
        if (!error && response.statusCode === 200) {
          const json = JSON.parse(body)[0];
          console.log(JSON.stringify(json, null, 2));
          resolve(json);
        } else {
          reject(`can not connect url = ${url}. \nError = ${error} \nResponseCode = ${response && response.statusCode} Body = ${body}`);
        }
      });
    });
  }

  private postGenerateFields (json: any, lang: Lang) {
    // congress
    if (lang === 'en') {
      json.congressDisplay = `${json.congress}th`;
    } else {
      json.congressDisplay = `${json.congress}屆`;
    }

    // bill code display
    json.billCodeDisplay = `${billTypes[json.billType].display} ${json.billNumber}`;

    // bill type display
    json.billTypeDisplay = billTypes[json.billType].displayType[lang];

    // introduced date display
    json.introducedDateDisplay = util.localTime(json.introducedDate);

    // last action display
    const actions = _.orderBy(json.actions, 'datetime', 'desc');
    const latest = _.head(actions);
    json.latestActionDisplay = `${util.localTime(latest.datetime)} - ${latest.description}`
  }

  private sponsorName (member, bill, lang: Lang): string {
    util.hydrateCongressRoles(member, lang);

    const sponsoredTime = parseInt(bill.introducedDate);
    const sponsorRole = _.find(member.congressRoles, r => sponsoredTime >= r.startDate && sponsoredTime < r.endDate)
    return `${sponsorRole.title} ${member.firstName || ''} ${member.middleName || ''} ${member.lastName || ''}`;
  }

  private async calculateWidth (text: string): Promise<number> {
    const d3n = new D3Node();
    const node = d3n.createSVG(0, 0).append('text')
    node.attr('font-family', 'Helvetica-Bold, Helvetica')
        .attr('font-size', '23')
        .attr('font-weight', 'bold')
        .attr('fill', '#4A4A4A')
        .attr('id', 'svg-text');
    node.text(text);
    let browser = await puppeteer.launch({ headless: true, args:['--no-sandbox'] });
    let page = await browser.newPage();
    await page.setContent(d3n.svgString());
    let width: number = await page.evaluate(() => document.getElementById('svg-text').clientWidth);
    browser.close();
    return width;
  }

  // return [SVG, svg-width]
  private async pill (text: string, dx: number = 0): Promise<[string, number]> {
    let width = await this.calculateWidth(text);
    let pillSvg = `
      <g id="BillCode" transform="translate(${40.000000 + dx}, 40.000000)">
        <rect id="Rectangle-2" fill="#E1E1E1" x="0" y="0" width="${width+40}" height="40" rx="20"></rect>
        <text id="congress" font-family="Helvetica-Bold, Helvetica" font-size="23" font-weight="bold" fill="#4A4A4A">
            <tspan x="${20}" y="26">${text}</tspan>
        </text>
      </g>
    `;
    return [pillSvg, width + 2 * 20];
  }
}
