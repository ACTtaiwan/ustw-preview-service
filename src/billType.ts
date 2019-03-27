import * as _ from 'lodash';

const meta = [
  {
    code: 'sres',
    display: 'S.Res.',
    displayType: {
      en: 'Resolution',
      zh: '決議案'
    }
  },
  {
    code: 'hres',
    display: 'H.Res.',
    displayType: {
      en: 'Resolution',
      zh: '決議案'
    }
  },
  {
    code: 'hjres',
    display: 'H.J.Res.',
    displayType: {
      en: 'Joint Resolution',
      zh: '聯合決議案'
    }
  },
  {
    code: 'sjres',
    display: 'S.J.Res.',
    displayType: {
      en: 'Joint Resolution',
      zh: '聯合決議案'
    }
  },
  {
    code: 'hconres',
    display: 'H.Con.Res.',
    displayType: {
      en: 'Concurrent Resolution',
      zh: '共同決議案'
    }
  },
  {
    code: 'sconres',
    display: 'S.Con.Res.',
    displayType: {
      en: 'Concurrent Resolution',
      zh: '共同決議案'
    }
  },
  {
    code: 's',
    display: 'S.',
    displayType: {
      en: 'Bill',
      zh: '法案'
    }
  },
  {
    code: 'hr',
    display: 'H.R.',
    displayType: {
      en: 'Bill',
      zh: '法案'
    }
  }
];

export default _.keyBy(meta, 'code');
