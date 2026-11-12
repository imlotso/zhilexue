'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assertIsolatedWordsLayout}=require('./test/words-layout-isolation.cjs');
const safe={CI:'true',ZLX_ISOLATED_TEST:'1',STORAGE_DRIVER:'local',MYSQL_HOST:'127.0.0.1',MYSQL_PORT:'32791',MYSQL_USER:'fixture',MYSQL_PASSWORD:'fixture',MYSQL_DATABASE:'zlx_layout_test_fixture',BASE:'http://127.0.0.1:13775'};
test('accepts only an explicitly isolated test setup',()=>{assert.doesNotThrow(()=>assertIsolatedWordsLayout(safe));for(const change of [{CI:''},{ZLX_ISOLATED_TEST:''},{STORAGE_DRIVER:'oss'},{MYSQL_HOST:'example.com'},{MYSQL_PORT:'3306'},{MYSQL_PORT:'13307'},{MYSQL_DATABASE:'zhilexue'},{MYSQL_PASSWORD:''},{RESTORED_DB_MODE:'1'},{BASE:'https://example.com'},{BASE:'http://127.0.0.1:3000/path'},{BASE:''}])assert.throws(()=>assertIsolatedWordsLayout({...safe,...change}),/isolated/)});
