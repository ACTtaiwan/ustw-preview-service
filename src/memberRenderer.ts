import * as restify from "restify";
import * as request from "request";
import * as fs from "fs";
import * as _ from "lodash";
import * as format from "string-template";
import billTypes from "./billType";
import * as util from "./utility";
import * as puppeteer from "puppeteer";
import { Lang, ReqImgType } from "./utility";
import { AppConfig } from "./appConfig";

const D3Node = require("d3-node");
const svg2png = require("svg2png");
const Datauri = require("datauri");
const datauri = new Datauri();
const { convert } = require("convert-svg-to-png");

export class MemberRenderer {
  private readonly template: string;
  private readonly defaultAvatar: string;
  private readonly fb: string;
  private readonly ig: string;
  private readonly line: string;
  private readonly states: { [key: string]: string };

  constructor() {
    this.template = fs.readFileSync("./assets/member-card-template.svg").toString();

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
        let [member, picDataUri, lastAction, lastActionTime, terms, votePercent] = await this.fetchMember(id, lang);
        let multiLines = this.multiLines(lastAction);
        let [pill1, dx1] = await this.pill("pill-area", member.memberAreaCode);
        let [pill2, dx2] = await this.pill("pill-party", member.memberParty, dx1 + 30);
        let [pill3, dx3] = await this.pill("pill-in-congress", member.isInCongress, dx1 + 30 + dx2 + 30);
        let card = format(this.template, {
          PILLS: member.isInCongress ? `${pill1}${pill2}${pill3}` : `${pill1}${pill2}`,
          PROFILE_PIC_BASE64: picDataUri,
          FB_PIC_BASE64: this.fb,
          IG_PIC_BASE64: this.ig,
          LINE_PIC_BASE64: this.line,
          AVATAR_COLOR: member.avatarColor,
          MEMBER_NAME: member.memberName,
          MEMBER_TITLE: member.memberTitle,
          SPONSOR_NUM: member.sponsoredBillIds.length,
          COSPONSOR_NUM: member.cosponsoredBillIds.length,
          TERMS: terms,
          PARTY_VOTE: votePercent,
          LAST_ACTION_TIME: lastActionTime,
          LAST_BILL_L1: multiLines[0],
          LAST_BILL_L2: multiLines[1],
          LAST_BILL_L3: multiLines[2]
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
      const png = await convert(card, {
        puppeteer: { headless: true, args: ["--no-sandbox"] }
      });
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

  // return [memberJson, imageDataUri, lastAction, lastActionTime, terms, votePercent]
  private fetchMember(id: string, lang: Lang): Promise<[any, string, string, string, number, string]> {
    const url = `${AppConfig.api}/v2?id=${id}&field=firstName&field=lastName&field=middleName&field=profilePictures&field=bioGuideId&field=latestRole&field=congressRoles&field=cosponsoredBillIds&field=sponsoredBillIds&field=cosponsoredBills%23date&lang=${lang}`;
    return new Promise((resolve, reject) => {
      request.get(url, (error, response, body) => {
        if (!error && response.statusCode === 200) {
          const json = JSON.parse(body)[0];
          this.postGenerateFields(json, lang);
          return Promise.all([
            this.fetchProfile(json.profilePictures),
            this.lastActionBill(json.sponsoredBillIds, json["cosponsoredBills#date"], lang),
            this.fetchProPublicaMember(json.bioGuideId)
          ]).then(([picDataUri, lastAction, ppMember]) => {
            let terms: number = ppMember.roles.map(role => role.congress).length;
            let votePercent = Number.parseFloat(ppMember.roles[0].votes_with_party_pct).toPrecision(2) + "%";
            resolve([json, picDataUri, lastAction[0], lastAction[1], terms, votePercent]);
          });
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

  private postGenerateFields(m: any, lang: Lang) {
    // generate roleTypeDisplay, title, titleLong, senatorClassDisplay for roles
    util.hydrateCongressRoles(m, lang);

    // latestRole & currentRole
    if (m.congressRoles) {
      const sortCngrRoles = _.orderBy(m.congressRoles, "endDate", "desc");
      const latest = _.head(sortCngrRoles);
      m.latestRole = _.cloneDeep(latest);
      if (latest && latest.endDate >= new Date().getTime()) {
        m.currentRole = _.cloneDeep(latest);
      }
    }

    // memberAreaCode
    let memberAreaCode = () => {
      if (m.latestRole.district) {
        return `${m.latestRole.state}-${m.latestRole.district}`;
      } else {
        return `${m.latestRole.state}`;
      }
    };
    m.memberAreaCode = memberAreaCode();

    // memberParty
    let memberParty = () => {
      const party = m.latestRole.party;
      const partyTrans = {
        zh: {
          Republican: "共和黨",
          Democrat: "民主黨"
        }
      }[lang];
      return (partyTrans && partyTrans[party]) || party;
    };
    m.memberParty = memberParty();

    // isInCongress
    m.isInCongress = !!m.currentRole;

    // avatarColor
    m.avatarColor = "#4a4a4a";
    if (m.latestRole && m.latestRole.party) {
      switch (m.latestRole.party) {
        case "Republican":
          m.avatarColor = "#e73a48";
          break;
        case "Democrat":
          m.avatarColor = "#4b8fea";
          break;
      }
    }

    let memberTitle = () => {
      const title = m.latestRole.titleLong;
      const state = this.states[m.latestRole.state][lang];
      const district = m.latestRole.district;
      if (lang === "zh") {
        if (district) {
          return `${state}第${district}區${title}`;
        } else {
          return `${state}${title}`;
        }
      } else {
        if (district) {
          return `${title} for ${state}'s ${district}th congressional district`;
        } else {
          return `${title} for ${state}`;
        }
      }
    };
    m.memberTitle = memberTitle();

    // memberName
    m.memberName = `${m.firstName || ""} ${m.middleName || ""} ${m.lastName || ""}`;
  }

  private async lastActionBill(
    sponsoredBillIds: string[],
    cosponsoredBillDates: { _id: string; date: number }[],
    lang: Lang
  ): Promise<string[]> {
    let chunckedIds = _.chunk(sponsoredBillIds, 10);
    let promises = chunckedIds.map(idsSubset => this.fetchBills(idsSubset, ["introducedDate"], lang));
    let apiResult = await Promise.all(promises);
    let billsFetched = _.flatten(apiResult);
    console.log(JSON.stringify(billsFetched, null, 2));
    let lastSppnsr = <{ _id: string; introducedDate: number }>_.maxBy(billsFetched, "introducedDate");
    let lastCospnsr = _.maxBy(cosponsoredBillDates, "date");
    let lastBillId: string;
    let lastDate: number = undefined;
    let isCospon: boolean = false;
    if (lastCospnsr && (!lastSppnsr || lastCospnsr.date > lastSppnsr.introducedDate)) {
      lastBillId = lastCospnsr._id;
      lastDate = lastCospnsr.date;
      isCospon = true;
    } else if (lastSppnsr && (!lastCospnsr || lastSppnsr.introducedDate > lastCospnsr.date)) {
      lastBillId = lastSppnsr._id;
      lastDate = lastSppnsr.introducedDate;
    }
    if (lastBillId) {
      let b = (await this.fetchBills([lastBillId], ["title", "billType", "billNumber"], lang))[0];
      let display = [];
      display.push(`${billTypes[b.billType].display} ${b.billNumber} - ${b.title} `);
      let dateDisplay = util.localTime(lastDate);
      if (lang === "en") {
        display.push(isCospon ? `(Cosponsored on ${dateDisplay})` : `(Sponsored on ${dateDisplay})`);
      } else {
        display.push(isCospon ? `(於${dateDisplay}共同連署)` : `(於${dateDisplay}提案)`);
      }
      return display;
    }
    return [""];
  }

  private fetchBills(billIds: string[], fields: string[], lang: Lang): Promise<any[]> {
    let qsp: string[] = [];
    _.each(billIds, id => qsp.push(`id=${id}`));
    _.each(fields, f => qsp.push(`field=${f}`));
    let url = `${AppConfig.api}/v2?lang=${lang}&${qsp.join("&")}`;
    return new Promise((resolve, reject) => {
      request.get(url, (error, response, body) => {
        if (!error && response.statusCode === 200) {
          const json = JSON.parse(body);
          resolve(json);
        } else {
          reject(`can not connect url = ${url}. \nError = ${error} \nResponseCode = ${response && response.statusCode} Body = ${body}`);
        }
      });
    });
  }

  private fetchProPublicaMember(bioGuideId: string): Promise<any> {
    let url = `https://api.propublica.org/congress/v1/members/${bioGuideId}.json`;
    return new Promise((resolve, reject) => {
      request.get(url, { headers: { "X-API-Key": process.env.PROPUBLICA_KEY } }, (error, response, body) => {
        if (!error && response.statusCode === 200) {
          const json = JSON.parse(body);
          resolve(json.results[0]);
        } else {
          reject(`can not connect url = ${url}. \nError = ${error} \nResponseCode = ${response && response.statusCode} Body = ${body}`);
        }
      });
    });
  }

  private multiLines(text: string): string[] {
    let parts = text.match(/.{1,74}/g);
    if (parts.length > 3) {
      parts[2] = parts[2].slice(0, parts[2].length - 4) + " ...";
    }
    return [parts[0] || "", parts[1] || "", parts[2] || ""];
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
  private async pill(id: string, text: any, dx: number = 0): Promise<[string, number]> {
    let isInCongressPill = typeof text === "boolean";
    let isInCongress = isInCongressPill && text;
    let bkgColor = isInCongressPill ? "#40C057" : "#E1E1E1";
    let textColor = isInCongressPill ? "#FFFFFF" : "#4A4A4A";
    let displayText = isInCongressPill ? "現任議員" : text;
    let displayTextWeight = isInCongressPill ? "400" : "500";
    let width = await this.calculateWidth(displayText);
    let pillSvg = "";
    console.log("####", isInCongressPill, isInCongress);

    if (isInCongressPill && !isInCongress) {
      pillSvg = "";
    } else {
      pillSvg = `
      <g id="${id}" transform="translate(${40.0 + dx}, 40.000000)">
        <rect id="pill" fill="${bkgColor}" fill-rule="evenodd" x="0" y="0" width="${width + 40}" height="44" rx="20"></rect>
        <text id="${displayText}" fill="none" font-family="SF Pro Display, Helvetica, 'sans-serif'" font-size="24" font-weight="${displayTextWeight}">
            <tspan x="${20}" y="30" fill="${textColor}">${displayText}</tspan>
        </text>
      </g>
    `;
    }

    return [pillSvg, width + 2 * 15];
  }
}
