import * as restify from "restify";
import * as request from "request";
import * as fs from "fs";
import * as _ from "lodash";
import * as format from "string-template";
import billTypes from "./billType";
import { Lang, ReqImgType } from "./utility";
import * as puppeteer from "puppeteer";
import * as util from "./utility";
import { AppConfig } from "./appConfig";

const D3Node = require("d3-node");
const svg2png = require("svg2png");
const Datauri = require("datauri");
const datauri = new Datauri();
const { convert } = require("convert-svg-to-png");
export class BillRenderer {
  private readonly template: string;
  private readonly defaultAvatar: string;
  private readonly fb: string;
  private readonly ig: string;
  private readonly line: string;
  private readonly states: { [key: string]: string };

  constructor() {
    this.template = fs.readFileSync("./assets/bill-card-template.svg").toString();

    // profile pic
    const buffer = fs.readFileSync("./assets/default-avatar.png");
    datauri.format(".png", buffer);
    this.defaultAvatar = datauri.content;

    // fb icon
    const fbBuffer = fs.readFileSync("./assets/icon-fb.png");
    datauri.format(".png", fbBuffer);
    this.fb = datauri.content;

    // ig icon
    const igBuffer = fs.readFileSync("./assets/icon-ig.png");
    datauri.format(".png", igBuffer);
    this.ig = datauri.content;

    // line icon
    const lineBuffer = fs.readFileSync("./assets/icon-line.png");
    datauri.format(".png", lineBuffer);
    this.line = datauri.content;

    this.states = JSON.parse(fs.readFileSync("./src/state.json").toString());
  }

  public async handleRequest(req: restify.Request, res: restify.Response) {
    let id: string = req.params.id;
    let lang: Lang = req.query.lang === "en" ? "en" : "zh";
    let imgType: ReqImgType;
    if (id.toLowerCase().endsWith(".png")) {
      imgType = "png";
    } else if (id.toLowerCase().endsWith(".svg")) {
      imgType = "svg";
    }
    if (imgType) {
      try {
        let [bill, sponsorName, sponsorTitle, picDataUri, avatarColor] = await this.fetchBill(id, lang);
        let [pill1, dx1] = await this.pill("pill-congress", bill.congressDisplay);
        let [pill2, dx2] = await this.pill("pill-billCode", bill.billCodeDisplay, dx1 + 30);
        let [pill3, dx3] = await this.pill("pill-billType", bill.billTypeDisplay, dx1 + 30 + dx2 + 30);
        let [pill4, dx4] = await this.pill("pill-billIntroDate", `${bill.introducedDateDisplay} 提案`, dx1 + 30 + dx2 + 30 + dx3 + 30);
        let card = format(this.template, {
          PILLS: `${pill1}${pill2}${pill3}${pill4}`,
          PROFILE_PIC_BASE64: picDataUri,
          FB_PIC_BASE64: this.fb,
          IG_PIC_BASE64: this.ig,
          LINE_PIC_BASE64: this.line,
          BILL_CODE: bill.billCodeDisplay,
          BILL_TITLE: bill.title,
          SPONSOR_NAME: sponsorName,
          SPONSOR_TITLE: sponsorTitle,
          COSPONSORS: bill.cosponsorIds.length,
          LAST_ACTION: bill.latestActionDisplay,
          LAST_ACTION_TIME: bill.latestActionTime,
          AVATAR_COLOR: avatarColor
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
    if (imgType === "png") {
      const png = await convert(card, { puppeteer: { headless: true, args: ["--no-sandbox"] } });
      res.set("Content-Type", "image/png");
      res.write(png, "binary");
      res.end(null, "binary");
      // svg2png(new Buffer(card), { width: 1200, height: 630 })
      // .then(buffer => {
      //   res.write(buffer,'binary');
      //   res.end(null, 'binary');
      // });
    } else {
      res.contentType = "image/svg+xml";
      res.write(card);
      res.end();
    }
  }

  // return [memberJson, sponsorName, sponsorTitle, picDataUri, avatarColor]
  private fetchBill(id: string, lang: Lang): Promise<[any, string, string, string, string]> {
    const url = `${AppConfig.api}/v2?id=${id}&field=title&field=congress&field=billType&field=billNumber&field=introducedDate&field=sponsorIds&field=cosponsorIds&field=actions&lang=${lang}`;
    return new Promise((resolve, reject) => {
      request.get(url, (error, response, body) => {
        if (!error && response.statusCode === 200) {
          const json = JSON.parse(body)[0];
          console.log(JSON.stringify(json, null, 2));
          this.postGenerateFields(json, lang);
          return Promise.all([this.fetchMember(json.sponsorIds[0], lang), this.fetchMemberProfilePic(json.sponsorIds[0], lang)]).then(
            ([member, picDataUri]) => {
              const sponsorName = this.sponsorName(member, json, lang);
              const [sponsorTitle, avatarColor] = this.sponsorTitleAndAvatarColor(member, json, lang);
              resolve([json, sponsorName, sponsorTitle, picDataUri, avatarColor]);
            }
          );
        } else {
          reject(`can not connect url = ${url}. \nError = ${error} \nResponseCode = ${response && response.statusCode} Body = ${body}`);
        }
      });
    });
  }

  // return base63 data URI
  private fetchProfile(profile?: { "200px"?: string }): Promise<string> {
    if (profile && profile["200px"]) {
      return new Promise((resolve, reject) => {
        request.get(profile["200px"], { encoding: null }, (error, response, body: Buffer) => {
          if (!error && response.statusCode === 200) {
            datauri.format(".png", body);
            resolve(datauri.content);
          } else {
            resolve(this.defaultAvatar);
          }
        });
      });
    } else {
      return Promise.resolve(this.defaultAvatar);
    }
  }

  private fetchMemberProfilePic(id: string, lang: Lang): Promise<any> {
    const url = `${AppConfig.api}/v2?id=${id}&field=profilePictures&lang=${lang}`;
    return new Promise((resolve, reject) => {
      request.get(url, (error, response, body) => {
        if (!error && response.statusCode === 200) {
          const json = JSON.parse(body)[0];
          return Promise.all([this.fetchProfile(json.profilePictures)]).then(([picDataUri]) => {
            resolve([picDataUri]);
          });
        } else {
          reject(`can not connect url = ${url}. \nError = ${error} \nResponseCode = ${response && response.statusCode} Body = ${body}`);
        }
      });
    });
  }

  private fetchMember(id: string, lang: Lang): Promise<any> {
    const url = `${AppConfig.api}/v2?id=${id}&field=firstName&field=lastName&field=middleName&field=congressRoles&lang=${lang}`;
    return new Promise((resolve, reject) => {
      request.get(url, (error, response, body) => {
        if (!error && response.statusCode === 200) {
          const json = JSON.parse(body)[0];
          resolve(json);
        } else {
          reject(`can not connect url = ${url}. \nError = ${error} \nResponseCode = ${response && response.statusCode} Body = ${body}`);
        }
      });
    });
  }

  private postGenerateFields(json: any, lang: Lang) {
    // congress
    if (lang === "en") {
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

    console.log("QQQQ", json);

    // last action display
    const actions = _.orderBy(json.actions, "datetime", "desc");
    const latest = _.head(actions);
    json.latestActionDisplay = latest.description.split(".")[0];
    json.latestActionTime = util.localTime(latest.datetime);
  }

  // return [title, avatar color]
  private sponsorTitleAndAvatarColor(member, bill, lang: Lang): [string, string] {
    util.hydrateCongressRoles(member, lang);

    const sponsoredTime = parseInt(bill.introducedDate);
    const sponsorRole = _.find(member.congressRoles, r => sponsoredTime >= r.startDate && sponsoredTime < r.endDate);

    const title = sponsorRole.titleLong;
    const state = this.states[sponsorRole.state][lang];
    const district = sponsorRole.district;

    let sponsorTitle = '';
    if (lang === "zh") {
      if (district) {
        sponsorTitle = `${state}第${district}區${title}`;
      } else {
        sponsorTitle = `${state}${title}`;
      }
    } else {
      if (district) {
        sponsorTitle = `${title} for ${state}'s ${district}th congressional district`;
      } else {
        sponsorTitle = `${title} for ${state}`;
      }
    }

    // avatarColor
    let avatarColor = "#4a4a4a";
    if (sponsorRole && sponsorRole.party) {
      switch (sponsorRole.party) {
        case "Republican":
          avatarColor = "#e73a48";
          break;
        case "Democrat":
          avatarColor = "#4b8fea";
          break;
      }
    }

    return [sponsorTitle, avatarColor];
  }

  private sponsorName(member, bill, lang: Lang): string {
    util.hydrateCongressRoles(member, lang);
    return `${member.firstName || ""} ${member.middleName || ""} ${member.lastName || ""}`;
  }

  private async calculateWidth(text: string): Promise<number> {
    const d3n = new D3Node();
    const node = d3n.createSVG(0, 0).append("text");
    node
      .attr("font-family", "SF Pro Display, Helvetica, 'sans-serif'")
      .attr("font-size", "24")
      .attr("font-weight", "400")
      .attr("fill", "#FFFFFF")
      .attr("id", "svg-text");
    node.text(text);
    let browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"]
    });
    let page = await browser.newPage();
    await page.setContent(d3n.svgString());
    let width: number = await page.evaluate(() => document.getElementById("svg-text").clientWidth);
    browser.close();
    return width;
  }

  // return [SVG, svg-width]
  private async pill(id: string, text: string, dx: number = 0): Promise<[string, number]> {
    let width = await this.calculateWidth(text);
    let pillSvg = `
      <g id="${id}" transform="translate(${40.0 + dx}, 40.000000)">
        <rect id="pill" fill="#E1E1E1" fill-rule="evenodd" x="0" y="0" width="${width + 40}" height="44" rx="20"></rect>
        <text id="${text}" fill="none" font-family="SF Pro Display, Helvetica, 'sans-serif'" font-size="24" font-weight="500">
            <tspan x="${20}" y="30" fill="#4A4A4A">${text}</tspan>
        </text>
      </g>
    `;
    return [pillSvg, width + 2 * 15];
  }
}
