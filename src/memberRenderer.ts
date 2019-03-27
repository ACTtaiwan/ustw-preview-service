import * as restify from 'restify';
import * as request from 'request';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as format from 'string-template';
import billTypes from './billType';
import * as util from './utility';
import { Lang, ReqImgType } from './utility';

const svg2png = require('svg2png');
const Datauri = require('datauri');
const datauri = new Datauri();
const { convert } = require('convert-svg-to-png');

export class MemberRenderer {
  private readonly template: string;
  private readonly defaultAvatar: string;
  private readonly states: {[key: string]: string};

  constructor () {
    this.template = fs.readFileSync('./assets/member-card-template.svg').toString();
    const buffer = fs.readFileSync('./assets/default-avatar.png');
    datauri.format('.png', buffer);
    this.defaultAvatar = datauri.content;
    this.states = JSON.parse(fs.readFileSync('./src/state.json').toString());
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
        let [member, picDataUri, lastAction, terms, votePercent] = await this.fetchMember(id, lang);
        let multiLines = this.multiLines(lastAction);
        let card = format(this.template, {
          MEMBER_AREA_CODE: member.memberAreaCode,
          PARTY: member.memberParty,
          IN_CONGRESS: member.isInCongress ? 1 : 0,
          PROFILE_PIC_BASE64: picDataUri,
          AVATAR_COLOR: member.avatarColor,
          MEMBER_NAME: member.memberName,
          MEMBER_TITLE: member.memberTitle,
          SPONSOR_NUM: member.sponsoredBillIds.length,
          COSPONSOR_NUM: member.cosponsoredBillIds.length,
          TERMS: terms,
          PARTY_VOTE: votePercent,
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

  // return [memberJson, imageDataUri, lastAction, terms, votePercent]
  private fetchMember(id: string, lang: Lang): Promise<[any, string, string, number, string]> {
    const url = `https://api.uswatch.tw/prod/v2?id=${id}&field=firstName&field=lastName&field=middleName&field=profilePictures&field=bioGuideId&field=latestRole&field=congressRoles&field=cosponsoredBillIds&field=sponsoredBillIds&field=cosponsoredBills%23date`;
    return new Promise((resolve, reject) => {
      request.get(url, (error, response, body) => {
        if (!error && response.statusCode === 200) {
          const json = JSON.parse(body)[0];
          console.log(JSON.stringify(json, null, 2));
          this.postGenerateFields(json, lang);
          return Promise.all([
            this.fetchProfile(json.profilePictures),
            this.lastActionBill(json.sponsoredBillIds, json['cosponsoredBills#date'], lang),
            this.fetchProPublicaMember(json.bioGuideId)
          ]).then(([picDataUri, lastAction, ppMember]) => {
            let terms: number = ppMember.roles.map(role => role.congress).length;
            let votePercent = Number.parseFloat(ppMember.roles[0].votes_with_party_pct).toPrecision(2) + '%';
            resolve([json, picDataUri, lastAction, terms, votePercent]);
          });
        } else {
          reject(`can not connect url = ${url}. \nError = ${error} \nResponseCode = ${response && response.statusCode} Body = ${body}`);
        }
      });
    });
  }

  // return base63 data URI
  private fetchProfile(profile?: {'200px'?: string}): Promise<string> {
    if (profile && profile["200px"]) {
      return new Promise((resolve, reject) => {
        request.get(profile["200px"], {encoding: null}, (error, response, body: Buffer) => {
          if (!error && response.statusCode === 200) {
            datauri.format('.png', body);
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

  private postGenerateFields (m: any, lang: Lang) {
    // generate roleTypeDisplay, title, titleLong, senatorClassDisplay for roles
    util.hydrateCongressRoles(m, lang);

    // latestRole & currentRole
    if (m.congressRoles) {
      const sortCngrRoles = _.orderBy(m.congressRoles, 'endDate', 'desc');
      const latest = _.head(sortCngrRoles);
      m.latestRole = _.cloneDeep(latest);
      if (latest && latest.endDate >= new Date().getTime()) {
        m.currentRole = _.cloneDeep(latest);
      }
    }

    // memberAreaCode
    let memberAreaCode = () => {
      if (m.latestRole.district) {
        return `${m.latestRole.state}-${m.latestRole.district}`
      } else {
        return `${m.latestRole.state}`
      }
    };
    m.memberAreaCode = memberAreaCode();

    // memberParty
    let memberParty = () => {
      const party = m.latestRole.party
      const partyTrans = {
        'zh': {
          'Republican': '共和黨',
          'Democrat': '民主黨'
        }
      }[lang];
      return (partyTrans && partyTrans[party]) || party
    };
    m.memberParty = memberParty();

    // isInCongress
    m.isInCongress = !!m.currentRole;

    // avatarColor
    m.avatarColor = '#4a4a4a';
    if (m.latestRole && m.latestRole.party) {
      switch (m.latestRole.party) {
        case 'Republican':
          m.avatarColor = '#e73a48';
          break
        case 'Democrat':
          m.avatarColor = '#4b8fea';
          break
      }
    }

    let memberTitle = () => {
      const title = m.latestRole.titleLong;
      const state = this.states[m.latestRole.state][lang];
      const district = m.latestRole.district;
      if (lang === 'zh') {
        if (district) {
          return `${state}第${district}區${title}`;
        } else {
          return `${state}${title}`;
        }  
      } else {
        if (district) {
          return `${title} for ${state}'s ${district}th congressional district`
        } else {
          return `${title} for ${state}`
        }  
      }
    }
    m.memberTitle = memberTitle();

    // memberName
    m.memberName = `${m.latestRole.title} ${m.firstName || ''} ${m.middleName || ''} ${m.lastName || ''}`;    
  }

  private async lastActionBill (sponsoredBillIds: string[], cosponsoredBillDates: {_id: string, date: number}[], lang: Lang): Promise<string> {
    let chunckedIds = _.chunk(sponsoredBillIds, 10);
    let promises = chunckedIds.map(idsSubset => this.fetchBills(idsSubset, ['introducedDate']));
    let apiResult = await Promise.all(promises);
    let billsFetched = _.flatten(apiResult);
    console.log(JSON.stringify(billsFetched, null, 2));
    let lastSppnsr = <{_id: string, introducedDate: number }> _.maxBy(billsFetched, 'introducedDate');
    let lastCospnsr = _.maxBy(cosponsoredBillDates, 'date');
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
      let b = (await this.fetchBills([lastBillId], ['title', 'billType', 'billNumber']))[0];
      let display = `${billTypes[b.billType].display} ${b.billNumber} - ${b.title} `
      let dateDisplay = util.localTime(lastDate);
      if (lang === 'en') {
        display += isCospon ? `(Cosponsored on ${dateDisplay})` : `(Sponsored on ${dateDisplay})`;
      } else {
        display += isCospon ? `（於${dateDisplay}共同連署）` : `（於${dateDisplay}提案）`;
      }
      return display;
    }
    return ''
  }

  private fetchBills (billIds: string[], fields: string[]): Promise<any[]> {
    let qsp: string[] = [];
    _.each(billIds, id => qsp.push(`id=${id}`));
    _.each(fields, f => qsp.push(`field=${f}`));
    let url = `https://api.uswatch.tw/dev/v2?${qsp.join('&')}`;
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
      request.get(
        url,
        { headers: { 'X-API-Key': 'syre14A0ZO81RzG81d5L4PbjkjF4Uu0aFWSjfNqf' } },
        (error, response, body) => {
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
    let parts = text.match(/.{1,100}/g);
    if (parts.length > 3) {
      parts[2] = parts[2].slice(0, parts[2].length-4) + ' ...';
    }
    return [
      parts[0] || '',
      parts[1] || '',
      parts[2] || ''
    ];
  }
}
