import './base-for-deps.css';
import './base-for-deps.scss';
import './base-for-deps.es';
import './base-for-deps.lang.json';
import './base-for-deps.rpc.json';

//we *do* expect (S)CSS imports targetting a deeper-level directly to work. that's a less complex situation than SCSS going deeper
import './deeper/direct-deeper.css';
import './deeper/direct-deeper.scss';

import "modtest";
import "modtest/modtest.es";
import "./deeper/find-modtest2";
