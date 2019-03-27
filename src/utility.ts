import * as moment from 'moment';
import * as _ from 'lodash';

export type Lang = 'en' | 'zh';
export type ReqImgType = 'svg' | 'png';

export function localTime(epoch) {
  return moment(new Date(Number(epoch)))
  .utcOffset(-5 * 60)
  .format('MM/DD/YYYY');
}

export function hydrateCongressRoles(member: any, lang: Lang) {
  if (!member || !member.congressRoles) {
    return;
  }

  const delegateStates = new Set(['MP', 'GU', 'AS', 'VI', 'PI', 'DK', 'DC']);

  // generate roleTypeDisplay, title, titleLong, senatorClassDisplay for roles
  _.each(member.congressRoles, r => {
    if (r.chamber === 'h') {
      r.roleTypeDisplay = (lang === 'zh') 
        ? '眾議員' 
        : 'Representative';

      if (r.state === 'PR') {
        r.titleLong = (lang === 'zh')
          ? '居民代表'
          : 'Resident Commissioner';
        r.title = (lang === 'zh')
          ? '居民代表'
          : 'Commish.';
      } else if (delegateStates.has(r.state)) {
        r.titleLong = (lang === 'zh')
          ? '委任代表'
          : 'Delegate';
        r.title = (lang === 'zh')
          ? '國會代表'
          : 'Rep.';
      } else {
        r.titleLong = (lang === 'zh')
          ? '眾議員'
          : 'Representative';
        r.title = (lang === 'zh')
          ? '眾議員'
          : 'Rep.';
      }
    }

    if (r.chamber === 's') {
      r.roleTypeDisplay = (lang === 'zh')
        ? '參議員'
        : 'Senator';
      r.titleLong = (lang === 'zh')
        ? '參議員'
        : 'Senator';
      r.title = (lang === 'zh')
        ? '參議員'
        : 'Sen.';
      r.senatorClassDisplay = (lang === 'zh')
        ? `第${r.senatorClass}組`
        : `Class ${r.senatorClass}`;
    }
  });
}
