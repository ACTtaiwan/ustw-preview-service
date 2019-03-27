require("dotenv").config();
import * as restify from "restify";
import { MemberRenderer } from './memberRenderer';
import { BillRenderer } from './billRenderer';

const server = restify.createServer();
const member = new MemberRenderer();
const bill = new BillRenderer();

server.use(require('restify-plugins').queryParser());
server.use(require('restify-plugins').bodyParser());

server.get('/', (req: restify.Request, res: restify.Response) => {
  res.send(200, 'Webpage OK!');
  res.end();
});

server.get('/member/:id',  (req: restify.Request, res: restify.Response) => {
  member.handleRequest(req, res);
});

server.get('/bill/:id',  (req: restify.Request, res: restify.Response) => {
  bill.handleRequest(req, res);
});

server.listen(process.env.PORT, () => console.log(`listening to port:` + process.env.PORT));
